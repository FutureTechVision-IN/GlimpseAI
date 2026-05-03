/**
 * Image enhancement matrix: restoration types x stylistic filters + filter-only path
 * + batch parity vs single enhanceImage.
 *
 * Skips when the ML sidecar is unreachable (CI without GPU stack).
 * Failures append one NDJSON line per case to qa-report/enhancement-matrix-failures.ndjson
 * including a user-facing symptom string suitable for a bug report.
 */
import { mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { enhanceImage, callBatchRestoration } from "./image-enhancer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const QA_REPORT_DIR = join(__dirname, "..", "..", "..", "..", "qa-report");
const FAILURE_LOG = join(QA_REPORT_DIR, "enhancement-matrix-failures.ndjson");

async function sidecarHealthy(): Promise<boolean> {
  if (process.env.SKIP_MEDIA_MATRIX === "1") return false;
  try {
    const base =
      process.env.RESTORATION_SERVICE_URL?.replace(/\/$/, "") ??
      `http://127.0.0.1:${process.env.RESTORATION_PORT ?? "7860"}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const ok = (await fetch(`${base}/health`, { signal: ctrl.signal })).ok;
    clearTimeout(timer);
    return ok;
  } catch {
    return false;
  }
}

function logFailure(entry: Record<string, unknown>): void {
  try {
    mkdirSync(QA_REPORT_DIR, { recursive: true });
    appendFileSync(
      FAILURE_LOG,
      `${JSON.stringify({
        ts: new Date().toISOString(),
        suite: "media-pipeline-matrix",
        ...entry,
      })}\n`,
    );
  } catch {
    /* non-fatal */
  }
}

// Top-level await: vitest collects tests after this resolves, so `healthy` is
// the live value when describe.skipIf evaluates.
const healthy: boolean = await sidecarHealthy();

async function buildSampleJpeg(): Promise<string> {
  // Synthetic sample with mild structure (gradient) so filter math has pixels
  // to actually move; flat-color buffers can collapse to identical bytes.
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

beforeAll(async () => {
  sampleJpegB64 = await buildSampleJpeg();
});

// ── Restoration x filter matrix ───────────────────────────────────────────────
const RESTORATION_TYPES = [
  "auto_face",
  "codeformer",
  "hybrid",
  "esrgan_upscale_2x",
  "old_photo_restore",
  "face_restore",
] as const;

const FILTER_IDS = ["vivid", "cinematic", "vintage", "original"] as const;

// Each ML-backed restoration call takes ~3-4s on CPU; the matrix runs two
// calls per case (filtered + plain reference for pixel-diff). Default vitest
// 5s timeout is too tight, so bump per-test to 60s.
const ML_CASE_TIMEOUT_MS = 60_000;

describe.skipIf(!healthy)("restoration x filter matrix", () => {
  for (const enhancementType of RESTORATION_TYPES) {
    for (const filterId of FILTER_IDS) {
      const caseId = `${enhancementType}__${filterId}`;
      it(
        caseId,
        async () => {
          try {
            const filtered = await enhanceImage(sampleJpegB64, "image/jpeg", {
              enhancementType,
              settings: filterId === "original" ? {} : { filterId },
            });
            expect(filtered.base64?.length ?? 0).toBeGreaterThan(64);
            expect(["image/jpeg", "image/png", "image/webp"]).toContain(filtered.mimeType);
            const decoded = Buffer.from(filtered.base64, "base64");
            const meta = await sharp(decoded).metadata();
            expect((meta.width ?? 0) > 0).toBe(true);
            expect((meta.height ?? 0) > 0).toBe(true);

            // For non-"original" filters, the bytes must differ vs the no-filter
            // restoration result (otherwise the filter is silently dropped).
            if (filterId !== "original") {
              const plain = await enhanceImage(sampleJpegB64, "image/jpeg", {
                enhancementType,
                settings: {},
              });
              if (filtered.base64 === plain.base64) {
                throw new Error(
                  `Filter "${filterId}" produced identical bytes vs no-filter -- filter not applied after restoration`,
                );
              }
            }
          } catch (e) {
            logFailure({
              caseId,
              enhancementType,
              filterId,
              mediaKind: "image",
              userSymptom:
                filterId === "original"
                  ? `Restoration "${enhancementType}" failed to produce output`
                  : `Filter "${filterId}" did not visibly apply after "${enhancementType}" restoration`,
              serverMessage: e instanceof Error ? e.message : String(e),
            });
            throw e;
          }
        },
        ML_CASE_TIMEOUT_MS,
      );
    }
  }
});

// ── Filter-only path (no restoration, type === "filter") ──────────────────────
describe("filter-only path", () => {
  for (const filterId of FILTER_IDS.filter((f) => f !== "original")) {
    const caseId = `filter_only__${filterId}`;
    it(caseId, async () => {
      try {
        const out = await enhanceImage(sampleJpegB64, "image/jpeg", {
          enhancementType: "filter",
          settings: { filterId },
        });
        expect(out.base64?.length ?? 0).toBeGreaterThan(64);
        const decoded = Buffer.from(out.base64, "base64");
        const meta = await sharp(decoded).metadata();
        expect((meta.width ?? 0) > 0).toBe(true);

        // Filter-only must change pixels vs the source.
        if (out.base64 === sampleJpegB64) {
          throw new Error(`Filter "${filterId}" produced output identical to source`);
        }
      } catch (e) {
        logFailure({
          caseId,
          filterId,
          mediaKind: "image",
          userSymptom: `Filter "${filterId}" did not modify the image when applied stand-alone`,
          serverMessage: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
    });
  }
});

// ── Batch parity (callBatchRestoration must match single enhanceImage bytes) ──
describe.skipIf(!healthy)("batch parity vs single enhanceImage", () => {
  for (const enhancementType of RESTORATION_TYPES) {
    const filterId = "vivid" as const;
    const caseId = `batch_parity__${enhancementType}__${filterId}`;
    it(
      caseId,
      async () => {
        try {
          const settings = { filterId };
          const single = await enhanceImage(sampleJpegB64, "image/jpeg", {
            enhancementType,
            settings,
          });
          const [batch0] = await callBatchRestoration([
            { base64Data: sampleJpegB64, enhancementType, settings },
          ]);
          expect(batch0.base64).toBe(single.base64);
          expect(batch0.mimeType).toBe(single.mimeType);
        } catch (e) {
          logFailure({
            caseId,
            enhancementType,
            filterId,
            mediaKind: "image",
            userSymptom:
              "Bulk-edit output differs from single-image enhancement (users would see inconsistent results)",
            serverMessage: e instanceof Error ? e.message : String(e),
          });
          throw e;
        }
      },
      ML_CASE_TIMEOUT_MS,
    );
  }
});

// ── Multi-image batch (Dashboard "Batch" card → Photo Studio queue) ──────────
// Mirrors the real /media/enhance-batch flow: N distinct uploads share one
// settings spec. Each result must be (a) a valid decodable image, (b) byte-
// identical to the single-file path for the same input, and (c) different
// from sibling outputs (no cross-contamination from sticky buffer reuse,
// accidental list-shuffling, or shared cache state).
//
// We use the `filter` enhancement (no ML, content-sensitive Sharp pipeline)
// because it transforms every distinct input deterministically and uses the
// `localItems` concurrency path inside callBatchRestoration — the path that
// actually fans out 4-at-a-time. This gives us a clean test for batch-fanout
// correctness without the synthetic-input collapse seen on tiny random
// patterns through Real-ESRGAN.
describe.skipIf(!healthy)("multi-image batch: parity + isolation", () => {
  const BATCH_SIZE = 4;
  const enhancementType = "filter" as const;
  const filterId = "vivid" as const;

  async function buildVariant(seed: number): Promise<string> {
    // 256x256 with substantial per-pixel variation so even after JPEG
    // quantization the inputs (and thus filtered outputs) stay distinct.
    const w = 256;
    const h = 256;
    const raw = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        raw[i] = (x + y * 2 + seed * 47) & 0xff;
        raw[i + 1] = (x * 3 + y + seed * 91) & 0xff;
        raw[i + 2] = ((x ^ y) + seed * 113) & 0xff;
      }
    }
    const buf = await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
      .jpeg({ quality: 90 })
      .toBuffer();
    return buf.toString("base64");
  }

  it(
    `multi_image_batch__size_${BATCH_SIZE}__${enhancementType}__${filterId}`,
    async () => {
      const caseId = `multi_image_batch__size_${BATCH_SIZE}`;
      try {
        const settings = { filterId };
        const inputs = await Promise.all(
          Array.from({ length: BATCH_SIZE }, (_, i) => buildVariant(i)),
        );

        // Sanity: test inputs really are distinct (otherwise everything below
        // is meaningless).
        expect(new Set(inputs).size).toBe(BATCH_SIZE);

        // Reference: enhance each input individually.
        const singles = await Promise.all(
          inputs.map((b64) =>
            enhanceImage(b64, "image/jpeg", { enhancementType, settings }),
          ),
        );

        // Single-path must already produce distinct outputs for distinct
        // inputs (otherwise no batch path could possibly do better).
        expect(new Set(singles.map((s) => s.base64)).size).toBe(BATCH_SIZE);

        // Batch path the route uses (POST /media/enhance-batch).
        const batched = await callBatchRestoration(
          inputs.map((b64) => ({
            base64Data: b64,
            enhancementType,
            settings,
          })),
        );

        expect(batched).toHaveLength(BATCH_SIZE);

        for (let i = 0; i < BATCH_SIZE; i++) {
          const decoded = Buffer.from(batched[i].base64, "base64");
          const meta = await sharp(decoded).metadata();
          expect((meta.width ?? 0) > 0).toBe(true);

          if (batched[i].base64 !== singles[i].base64) {
            throw new Error(
              `Batch index ${i} differs from single-image path -- bulk edits would produce different results than per-file enhance`,
            );
          }
        }

        const uniq = new Set(batched.map((r) => r.base64));
        if (uniq.size !== BATCH_SIZE) {
          throw new Error(
            `Batch produced ${uniq.size} distinct outputs for ${BATCH_SIZE} distinct inputs -- pipeline is collapsing items together`,
          );
        }
      } catch (e) {
        logFailure({
          caseId,
          enhancementType,
          filterId,
          batchSize: BATCH_SIZE,
          mediaKind: "image",
          userSymptom:
            "Batch enhancement queue: at least one file came back wrong (bytes mismatch vs single-file, or items collapsed together)",
          serverMessage: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
    },
    ML_CASE_TIMEOUT_MS * 2,
  );
});
