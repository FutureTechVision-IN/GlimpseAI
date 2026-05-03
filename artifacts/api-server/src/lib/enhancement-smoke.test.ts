/**
 * Pipeline smoke tests: premium-tier image enhancements + optional video restoration.
 * Exercises enhanceImage (production path). When Python sidecar is up, ML-backed
 * types are slower; stop RESTORATION_SERVICE or set SKIP_VIDEO_SMOKE for quicker runs.
 */
import { readFileSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeAll } from "vitest";
import sharp from "sharp";
import { enhanceImage, callVideoRestoration } from "./image-enhancer";
import { getTierCapabilities } from "./tier-config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const QA_REPORT_DIR = join(__dirname, "..", "..", "..", "..", "qa-report");
const FAILURE_LOG = join(QA_REPORT_DIR, "enhancement-smoke-failures.ndjson");

function logSmokeFailure(entry: Record<string, unknown>): void {
  try {
    mkdirSync(QA_REPORT_DIR, { recursive: true });
    appendFileSync(
      FAILURE_LOG,
      `${JSON.stringify({
        ts: new Date().toISOString(),
        suite: "enhancement-smoke",
        ...entry,
      })}\n`,
    );
  } catch {
    /* non-fatal */
  }
}

let sampleJpegB64: string;

beforeAll(async () => {
  const buf = await sharp({
    create: {
      width: 96,
      height: 96,
      channels: 3,
      background: { r: 120, g: 80, b: 140 },
    },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
  sampleJpegB64 = buf.toString("base64");
});

const premiumTypes = [...getTierCapabilities("premium").allowedEnhancements].filter(
  (t) => t !== "video_restore",
);

describe("image enhancement smoke (premium types)", { timeout: 900_000 }, () => {
  it.each(premiumTypes)("enhanceImage(%s) returns decodable output", async (enhancementType) => {
    const settings: Record<string, unknown> =
      enhancementType === "filter" ? { filterId: "vivid" } : {};

    try {
      const out = await enhanceImage(sampleJpegB64, "image/jpeg", {
        enhancementType,
        settings,
      });

      expect(out.base64?.length ?? 0).toBeGreaterThan(64);
      expect(["image/jpeg", "image/png", "image/webp"]).toContain(out.mimeType);

      const decoded = Buffer.from(out.base64, "base64");
      expect(decoded.length).toBeGreaterThan(32);

      const meta = await sharp(decoded).metadata();
      expect(meta.width).toBeGreaterThan(0);
      expect(meta.height).toBeGreaterThan(0);
    } catch (e) {
      logSmokeFailure({
        caseId: `smoke__image__${enhancementType}`,
        enhancementType,
        userSymptom: `Photo Studio: "${enhancementType}" enhancement failed end-to-end — no decodable image output returned to the user`,
        serverMessage: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  });
});

describe("video restoration smoke (optional)", { timeout: 900_000 }, () => {
  it("restore-video returns payload when sidecar is healthy", async () => {
    if (process.env.SKIP_VIDEO_SMOKE === "1") {
      return;
    }

    const base =
      process.env.RESTORATION_SERVICE_URL?.replace(/\/$/, "") ??
      `http://127.0.0.1:${process.env.RESTORATION_PORT ?? "7860"}`;

    let healthy = false;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      healthy = (await fetch(`${base}/health`, { signal: ctrl.signal })).ok;
      clearTimeout(timer);
    } catch {
      healthy = false;
    }

    if (!healthy) {
      return;
    }

    let mp4b64: string;
    try {
      mp4b64 = readFileSync(
        join(__dirname, "fixtures/minimal-smoke.mp4.b64"),
        "utf8",
      ).trim();
    } catch {
      throw new Error("Missing fixtures/minimal-smoke.mp4.b64");
    }

    const v = await callVideoRestoration(mp4b64, "upscale_2x", false, 8, false, "auto");
    expect(v.base64.length).toBeGreaterThan(100);
    expect(v.framesProcessed).toBeGreaterThan(0);

  });
});
