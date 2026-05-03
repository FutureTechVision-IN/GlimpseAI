/**
 * Enhancement chain matrix:
 *
 *   [enhance] × [filter] × [upscale] × [image | video]
 *
 * Validates the orchestrator added in Phase 2 (`runEnhancementChain`) plus
 * the video parity work in Phase 4. Each failure writes one NDJSON line to
 * qa-report/chain-matrix-failures.ndjson including a `userSymptom` string
 * that a triage engineer can paste straight into a bug report.
 *
 * Skip rules:
 *   - SKIP_CHAIN_MATRIX=1 short-circuits the whole suite.
 *   - Chain image cases run against the sidecar OR fall back to native
 *     Sharp (so they exercise the no-Docker path too). They never skip on
 *     restoration_model availability — the orchestrator itself transparently
 *     downshifts to native when the sidecar is offline.
 *   - Video chain cases skip when the sidecar isn't reachable or doesn't
 *     advertise `video_restore`.
 */
import { mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { runEnhancementChain, type ChainSpec, type UpscaleOp } from "./enhancement-pipeline";
import { callVideoRestoration } from "./image-enhancer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const QA_REPORT_DIR = join(__dirname, "..", "..", "..", "..", "qa-report");
const FAILURE_LOG = join(QA_REPORT_DIR, "chain-matrix-failures.ndjson");
const VIDEO_FIXTURE = join(__dirname, "fixtures", "minimal-smoke.mp4.b64");

async function sidecarHealthy(): Promise<{ ok: boolean; videoCapable: boolean }> {
  if (process.env.SKIP_CHAIN_MATRIX === "1") return { ok: false, videoCapable: false };
  try {
    const base =
      process.env.RESTORATION_SERVICE_URL?.replace(/\/$/, "") ??
      `http://127.0.0.1:${process.env.RESTORATION_PORT ?? "7860"}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${base}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, videoCapable: false };
    const body = (await res.json()) as { capabilities?: string[] };
    const caps = Array.isArray(body.capabilities) ? body.capabilities : [];
    return { ok: true, videoCapable: caps.includes("video_restore") };
  } catch {
    return { ok: false, videoCapable: false };
  }
}

function logFailure(entry: Record<string, unknown>): void {
  try {
    mkdirSync(QA_REPORT_DIR, { recursive: true });
    appendFileSync(
      FAILURE_LOG,
      `${JSON.stringify({
        ts: new Date().toISOString(),
        suite: "enhancement-chain-matrix",
        ...entry,
      })}\n`,
    );
  } catch {
    /* non-fatal */
  }
}

const health = await sidecarHealthy();
const skipChain = process.env.SKIP_CHAIN_MATRIX === "1";

async function buildSampleJpeg(): Promise<string> {
  const w = 96;
  const h = 96;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      raw[i] = (x * 2) & 0xff;
      raw[i + 1] = (y * 2) & 0xff;
      raw[i + 2] = ((x + y) * 1) & 0xff;
    }
  }
  const buf = await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 88 })
    .toBuffer();
  return buf.toString("base64");
}

let sampleJpegB64 = "";
let videoB64: string | null = null;

beforeAll(async () => {
  sampleJpegB64 = await buildSampleJpeg();
  try {
    videoB64 = readFileSync(VIDEO_FIXTURE, "utf8").trim();
  } catch {
    videoB64 = null;
  }
});

// ─── Image chain matrix (always runs, with native fallback) ───────────────
const ENHANCE_OPS: Array<string | null> = ["auto_face", "auto", "portrait", "color_grade_cinematic"];
const FILTER_IDS: Array<string | null> = ["vivid", "vintage", "cinematic", "original"];
const UPSCALE_OPS: Array<UpscaleOp | null> = [null, "upscale", "upscale_4x"];

describe.skipIf(skipChain)("enhancement chain matrix (image)", { timeout: 600_000 }, () => {
  for (const enhance of ENHANCE_OPS) {
    for (const filterId of FILTER_IDS) {
      for (const upscale of UPSCALE_OPS) {
        // Skip the 1×1×1 "all null" combination — runEnhancementChain rejects it.
        if (!enhance && (!filterId || filterId === "original") && !upscale) continue;
        const caseId = `image__${enhance ?? "noop"}__${filterId ?? "none"}__${upscale ?? "no_upscale"}`;
        it(caseId, async () => {
          const spec: ChainSpec = {
            enhance,
            filterId: filterId === "original" ? null : filterId,
            upscale,
          };
          try {
            const result = await runEnhancementChain(sampleJpegB64, "image/jpeg", spec);
            expect(result.base64.length).toBeGreaterThan(50);
            expect(result.stages.length).toBeGreaterThan(0);
            // Sanity: every stage we asked for should appear in the report.
            const stageOps = result.stages.map((s) => s.stage);
            if (spec.enhance) expect(stageOps).toContain("enhance");
            if (spec.filterId) expect(stageOps).toContain("filter");
            if (spec.upscale) expect(stageOps).toContain("upscale");
          } catch (e) {
            const human = `Photo Studio: enhance=${enhance ?? "none"}, filter=${filterId ?? "none"}, upscale=${upscale ?? "none"} — chain failed; user would see a failed job in History`;
            logFailure({
              caseId,
              mediaKind: "image",
              enhance,
              filter: filterId,
              upscale,
              userSymptom: human,
              serverMessage: e instanceof Error ? e.message : String(e),
              servedBy: health.ok ? "sidecar" : "native",
            });
            throw e;
          }
        });
      }
    }
  }
});

// ─── Video chain matrix (skips on missing sidecar / fixture) ──────────────
describe.skipIf(skipChain || !health.videoCapable)(
  "enhancement chain matrix (video)",
  { timeout: 900_000 },
  () => {
    const VIDEO_CASES: Array<{ id: string; mode: string; filterId: string | null; upscale: string | null; symptom: string }> = [
      {
        id: "video__face_restore__vintage__upscale_2x",
        mode: "face_restore",
        filterId: "vintage",
        upscale: "upscale",
        symptom:
          "Video Studio: Auto-Face + Vintage filter + 2× upscale failed — vintage tone or upscale missing in output",
      },
      {
        id: "video__upscale_4x__cinematic",
        mode: "upscale_4x",
        filterId: "cinematic",
        upscale: "upscale_4x",
        symptom:
          "Video Studio: 4× upscale + Cinematic filter failed — output ungraded or wrong resolution",
      },
      {
        id: "video__upscale_2x__unmapped_airy",
        mode: "upscale_2x",
        filterId: "airy",
        upscale: null,
        symptom:
          "Video Studio: Unmapped filter (airy) failed — sidecar should approximate per-frame, not error",
      },
    ];

    for (const spec of VIDEO_CASES) {
      it(spec.id, async () => {
        if (!videoB64) {
          logFailure({
            caseId: spec.id,
            mediaKind: "video",
            userSymptom: "Video chain matrix could not run — bundled fixture missing",
            serverMessage: `Missing ${VIDEO_FIXTURE}`,
          });
          throw new Error(`Missing ${VIDEO_FIXTURE}`);
        }
        try {
          const out = await callVideoRestoration(
            videoB64,
            spec.mode,
            true, // faceEnhance
            8,    // maxFrames
            true, // temporalConsistency
            "auto",
            null, // colorGrade — let filter_id handle styling
            spec.filterId,
            spec.upscale,
          );
          expect(out.base64.length).toBeGreaterThan(100);
          expect(out.framesProcessed).toBeGreaterThan(0);
        } catch (e) {
          logFailure({
            caseId: spec.id,
            mediaKind: "video",
            mode: spec.mode,
            filter: spec.filterId,
            upscale: spec.upscale,
            userSymptom: spec.symptom,
            serverMessage: e instanceof Error ? e.message : String(e),
          });
          throw e;
        }
      });
    }
  },
);
