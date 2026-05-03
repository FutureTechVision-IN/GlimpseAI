/**
 * Video enhancement matrix: restoration_model x color_grade plus stabilize/trim smokes.
 *
 * Skips when:
 *  - sidecar `/health` is unreachable, OR
 *  - SKIP_VIDEO_MATRIX=1, OR
 *  - the bundled fixture cannot be loaded.
 *
 * Failures append one NDJSON line per case to qa-report/video-matrix-failures.ndjson
 * including a user-facing symptom string suitable for a bug report.
 */
import { mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { callVideoRestoration } from "./image-enhancer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const QA_REPORT_DIR = join(__dirname, "..", "..", "..", "..", "qa-report");
const FAILURE_LOG = join(QA_REPORT_DIR, "video-matrix-failures.ndjson");
const FIXTURE_PATH = join(__dirname, "fixtures", "minimal-smoke.mp4.b64");

async function sidecarHealthy(): Promise<boolean> {
  if (process.env.SKIP_VIDEO_MATRIX === "1") return false;
  try {
    const base =
      process.env.RESTORATION_SERVICE_URL?.replace(/\/$/, "") ??
      `http://127.0.0.1:${process.env.RESTORATION_PORT ?? "7860"}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${base}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const body = (await res.json()) as { capabilities?: string[] };
    return Array.isArray(body.capabilities) && body.capabilities.includes("video_restore");
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
        suite: "video-pipeline-matrix",
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
let mp4b64: string | null = null;

beforeAll(() => {
  try {
    mp4b64 = readFileSync(FIXTURE_PATH, "utf8").trim();
  } catch {
    mp4b64 = null;
  }
});

const RESTORATION_MODELS = ["auto", "gfpgan", "codeformer"] as const;
const COLOR_GRADES = ["warm", "cool", "cinematic", null] as const;

describe.skipIf(!healthy)("video restoration_model x color_grade matrix", { timeout: 600_000 }, () => {
  for (const restorationModel of RESTORATION_MODELS) {
    for (const colorGrade of COLOR_GRADES) {
      const caseId = `video__${restorationModel}__${colorGrade ?? "none"}`;
      it(caseId, async () => {
        if (!mp4b64) {
          logFailure({
            caseId,
            restorationModel,
            colorGrade,
            mediaKind: "video",
            userSymptom: "Video matrix could not run -- bundled fixture missing",
            serverMessage: `Missing ${FIXTURE_PATH}`,
          });
          throw new Error(`Missing ${FIXTURE_PATH}`);
        }
        try {
          const out = await callVideoRestoration(
            mp4b64,
            "upscale_2x",       // mode: matches editor default
            true,                // faceEnhance
            8,                   // maxFrames -- keep tests quick
            true,                // temporalConsistency
            restorationModel,
            colorGrade,
          );
          expect(out.base64.length).toBeGreaterThan(100);
          expect(out.framesProcessed).toBeGreaterThan(0);
          expect(typeof out.mimeType).toBe("string");
        } catch (e) {
          logFailure({
            caseId,
            restorationModel,
            colorGrade,
            mediaKind: "video",
            userSymptom:
              colorGrade
                ? `Color grade "${colorGrade}" with model "${restorationModel}" failed -- video output may be missing the grade`
                : `Video restoration with model "${restorationModel}" failed`,
            serverMessage: e instanceof Error ? e.message : String(e),
          });
          throw e;
        }
      });
    }
  }
});

describe.skipIf(!healthy)("video editor smokes (trim / stabilize via sidecar)", { timeout: 600_000 }, () => {
  it("face_restore mode produces non-empty output (stabilize-equivalent path)", async () => {
    if (!mp4b64) return;
    try {
      const out = await callVideoRestoration(
        mp4b64,
        "face_restore",
        true,
        8,
        true,
        "auto",
        null,
      );
      expect(out.base64.length).toBeGreaterThan(100);
      expect(out.framesProcessed).toBeGreaterThan(0);
    } catch (e) {
      logFailure({
        caseId: "video__face_restore_smoke",
        restorationModel: "auto",
        colorGrade: null,
        mediaKind: "video",
        userSymptom: "Video Studio: AI Face Restore on a clip failed -- users would see a failed job",
        serverMessage: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  });

  it("upscale_4x mode with cinematic grade produces non-empty output", async () => {
    if (!mp4b64) return;
    try {
      const out = await callVideoRestoration(
        mp4b64,
        "upscale_4x",
        false,
        8,
        true,
        "auto",
        "cinematic",
      );
      expect(out.base64.length).toBeGreaterThan(100);
      expect(out.framesProcessed).toBeGreaterThan(0);
    } catch (e) {
      logFailure({
        caseId: "video__upscale_4x_cinematic_smoke",
        restorationModel: "auto",
        colorGrade: "cinematic",
        mediaKind: "video",
        userSymptom: "Video Studio: 4x upscale + cinematic grade failed -- users would see no graded output",
        serverMessage: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  });
});

// ─── New parity matrix: auto_face / cinematic + filter_id + upscale ───────
describe.skipIf(!healthy)("video parity matrix (filterId + upscale)", { timeout: 600_000 }, () => {
  const PARITY_CASES: Array<{
    id: string;
    mode: string;
    colorGrade: string | null;
    filterId: string | null;
    upscale: string | null;
    symptom: string;
  }> = [
    {
      id: "video__auto_face__vintage__upscale_2x",
      mode: "face_restore",
      colorGrade: null,
      filterId: "vintage",
      upscale: "upscale",
      symptom: "Video: Auto-Face + Vintage filter + 2x upscale produced no usable output",
    },
    {
      id: "video__cinematic_grade__cinematic__upscale_4x",
      mode: "upscale_4x",
      colorGrade: "cinematic",
      filterId: "cinematic",
      upscale: "upscale_4x",
      symptom: "Video: Cinematic grade + Cinematic filter + 4x upscale failed",
    },
    {
      id: "video__unmapped_filter__airy",
      mode: "upscale_2x",
      colorGrade: null,
      filterId: "airy",
      upscale: null,
      symptom:
        "Video: Unmapped filter (airy) failed — sidecar should fall back to per-frame approximation, not error",
    },
  ];
  for (const caseSpec of PARITY_CASES) {
    it(caseSpec.id, async () => {
      if (!mp4b64) return;
      try {
        const out = await callVideoRestoration(
          mp4b64,
          caseSpec.mode,
          true,
          8,
          true,
          "auto",
          caseSpec.colorGrade,
          caseSpec.filterId,
          caseSpec.upscale,
        );
        expect(out.base64.length).toBeGreaterThan(100);
        expect(out.framesProcessed).toBeGreaterThan(0);
      } catch (e) {
        logFailure({
          caseId: caseSpec.id,
          restorationModel: "auto",
          colorGrade: caseSpec.colorGrade,
          filterId: caseSpec.filterId,
          upscale: caseSpec.upscale,
          mediaKind: "video",
          userSymptom: caseSpec.symptom,
          serverMessage: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
    });
  }
});
