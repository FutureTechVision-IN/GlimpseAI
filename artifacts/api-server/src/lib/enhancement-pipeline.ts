/**
 * enhancement-pipeline.ts
 *
 * Orchestrator for the user-visible "Enhance → Filter → Upscale" workflow.
 *
 * Architectural rationale (informed by the SRE-core graphify report):
 *   - image-enhancer.ts already trends toward a "DataProcessorService" god
 *     node (~1300 lines, large dispatch switch). Stacking the chain logic
 *     in there would worsen the anti-pattern.
 *   - This file is a thin orchestrator: it composes the existing primitives
 *     (enhanceImage / callVideoRestoration) into a deterministic 3-stage
 *     pipeline and produces ONE final asset, not three intermediate jobs.
 *   - Stages can be skipped (null) so partial chains are supported:
 *       enhance only, enhance + filter, enhance + upscale, etc.
 *   - When the restoration sidecar is unreachable, every stage transparently
 *     falls back to the Sharp-only path inside image-enhancer.ts, so the
 *     pipeline still produces a usable result on a no-Docker host.
 */

import { enhanceImage, isRestorationServiceAvailable } from "./image-enhancer";
import { logger } from "./logger";
import type { AIEnhancementGuidance } from "./ai-provider";

export type UpscaleOp = "upscale" | "upscale_4x" | "esrgan_upscale_2x" | "esrgan_upscale_4x";

export interface ChainSpec {
  /** Primary enhancement (e.g. auto_face, auto, portrait, color_grade_cinematic). Optional — pass null to skip. */
  enhance?: string | null;
  /** Filter id from the canonical filter registry, applied AFTER enhancement. */
  filterId?: string | null;
  /** Upscale operation, applied LAST. */
  upscale?: UpscaleOp | null;
  /** Optional AI guidance forwarded to the enhance stage only. */
  aiGuidance?: AIEnhancementGuidance | null;
  /** Pass-through extra settings (e.g. videoColorGrade, restorationModel). */
  settings?: Record<string, unknown>;
}

export interface ChainStageReport {
  stage: "enhance" | "filter" | "upscale";
  op: string;
  ms: number;
  servedBy: "sidecar" | "native";
}

export interface ChainResult {
  base64: string;
  mimeType: string;
  stages: ChainStageReport[];
  /**
   * Final servedBy: "sidecar" if ANY restoration stage actually used the
   * Python service, "native" otherwise. Surfaced to the UI as a badge.
   */
  servedBy: "sidecar" | "native";
}

/**
 * Operations that, when used as the primary enhance step, expect the Python
 * restoration sidecar. They still work natively (fallback inside
 * image-enhancer.ts) but with weaker visual quality.
 */
const RESTORATION_ENHANCE_OPS = new Set<string>([
  "face_restore",
  "face_restore_hd",
  "codeformer",
  "auto_face",
  "hybrid",
  "old_photo_restore",
  "esrgan_upscale_2x",
  "esrgan_upscale_4x",
]);

function sniffMimeFromRawBase64(base64Data: string): string {
  if (base64Data.startsWith("/9j/")) return "image/jpeg";
  if (base64Data.startsWith("iVBOR")) return "image/png";
  if (base64Data.startsWith("UklGR")) return "image/webp";
  return "image/jpeg";
}

/**
 * Run a full enhance → filter → upscale chain on a single image.
 *
 * Stages are skipped when null/undefined. Each stage feeds the previous
 * stage's output buffer as input, so filters always run AFTER enhancement
 * and upscale always runs LAST.
 *
 * Throws on hard errors; never silently degrades.
 */
export async function runEnhancementChain(
  base64Data: string,
  mimeType: string,
  spec: ChainSpec,
): Promise<ChainResult> {
  const stages: ChainStageReport[] = [];
  const sidecarAvailable = await isRestorationServiceAvailable();
  let servedBySidecar = false;

  let buffer = base64Data;
  let bufferMime = mimeType;

  // ─── Stage 1: Enhance ────────────────────────────────────────────────
  if (spec.enhance && spec.enhance !== "none") {
    const t0 = Date.now();
    const useSidecar = sidecarAvailable && RESTORATION_ENHANCE_OPS.has(spec.enhance);
    try {
      const out = await enhanceImage(buffer, bufferMime, {
        enhancementType: spec.enhance,
        settings: spec.settings,
        aiGuidance: spec.aiGuidance ?? null,
      });
      buffer = out.base64;
      bufferMime = out.mimeType;
      stages.push({
        stage: "enhance",
        op: spec.enhance,
        ms: Date.now() - t0,
        servedBy: useSidecar ? "sidecar" : "native",
      });
      if (useSidecar) servedBySidecar = true;
    } catch (err) {
      logger.error({ err, op: spec.enhance }, "Enhancement chain: enhance stage failed");
      throw err;
    }
  }

  // ─── Stage 2: Filter (post-enhance) ───────────────────────────────────
  // Implemented by re-running enhanceImage with enhancementType="filter" so
  // the canonical filter registry pipeline is applied to the enhanced
  // buffer. This reuses the exact code path that the existing /media/preview
  // and /media/enhance use, guaranteeing visual parity.
  if (spec.filterId && spec.filterId !== "original") {
    const t0 = Date.now();
    try {
      const out = await enhanceImage(buffer, bufferMime, {
        enhancementType: "filter",
        settings: { ...(spec.settings ?? {}), filterId: spec.filterId },
        aiGuidance: null,
      });
      buffer = out.base64;
      bufferMime = out.mimeType;
      stages.push({
        stage: "filter",
        op: spec.filterId,
        ms: Date.now() - t0,
        servedBy: "native",
      });
    } catch (err) {
      logger.error({ err, op: spec.filterId }, "Enhancement chain: filter stage failed");
      throw err;
    }
  }

  // ─── Stage 3: Upscale (last) ──────────────────────────────────────────
  if (spec.upscale) {
    const t0 = Date.now();
    const useSidecar = sidecarAvailable &&
      (spec.upscale === "esrgan_upscale_2x" || spec.upscale === "esrgan_upscale_4x");
    try {
      const out = await enhanceImage(buffer, bufferMime, {
        enhancementType: spec.upscale,
        settings: spec.settings,
        aiGuidance: null,
      });
      buffer = out.base64;
      bufferMime = out.mimeType;
      stages.push({
        stage: "upscale",
        op: spec.upscale,
        ms: Date.now() - t0,
        servedBy: useSidecar ? "sidecar" : "native",
      });
      if (useSidecar) servedBySidecar = true;
    } catch (err) {
      logger.error({ err, op: spec.upscale }, "Enhancement chain: upscale stage failed");
      throw err;
    }
  }

  // If no stages were specified, just normalise & return (defensive).
  if (stages.length === 0) {
    return {
      base64: buffer,
      mimeType: bufferMime || sniffMimeFromRawBase64(buffer),
      stages,
      servedBy: "native",
    };
  }

  return {
    base64: buffer,
    mimeType: bufferMime,
    stages,
    servedBy: servedBySidecar ? "sidecar" : "native",
  };
}

/**
 * Validate a chain spec against tier rules. Caller still does coarse tier
 * checks via tier-config; this is a finer-grained shape check.
 */
export function validateChainSpec(spec: ChainSpec): { ok: true } | { ok: false; error: string } {
  if (!spec.enhance && !spec.filterId && !spec.upscale) {
    return { ok: false, error: "Chain must include at least one of enhance / filterId / upscale." };
  }
  if (spec.enhance && typeof spec.enhance !== "string") {
    return { ok: false, error: "enhance must be a string enhancement id." };
  }
  if (spec.filterId && typeof spec.filterId !== "string") {
    return { ok: false, error: "filterId must be a string filter id." };
  }
  if (spec.upscale && !["upscale", "upscale_4x", "esrgan_upscale_2x", "esrgan_upscale_4x"].includes(spec.upscale)) {
    return { ok: false, error: `upscale must be one of upscale, upscale_4x, esrgan_upscale_2x, esrgan_upscale_4x — got ${spec.upscale}.` };
  }
  return { ok: true };
}
