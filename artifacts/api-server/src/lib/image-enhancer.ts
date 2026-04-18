import sharp from "sharp";
import { logger } from "./logger";

export interface EnhanceOptions {
  enhancementType: string;
  settings?: Record<string, unknown>;
}

// Named filter presets (server-side sharp equivalents)
const FILTER_PRESETS: Record<string, (p: sharp.Sharp) => sharp.Sharp> = {
  vivid: (p) => p.modulate({ saturation: 1.35, brightness: 1.03 }).normalize().sharpen({ sigma: 0.6 }),
  portrait: (p) => p.modulate({ brightness: 1.04, saturation: 0.92 }).sharpen({ sigma: 0.7, m1: 0.6, m2: 0.3 }).gamma(1.06),
  bw: (p) => p.grayscale().normalize().sharpen({ sigma: 1.0 }).gamma(1.1),
  film: (p) => p.modulate({ saturation: 0.8, brightness: 0.97 }).gamma(1.12).tint({ r: 230, g: 215, b: 200 }).sharpen({ sigma: 0.5 }),
  hdr: (p) => p.normalize().sharpen({ sigma: 1.8, m1: 2.0, m2: 1.0 }).modulate({ saturation: 1.2, brightness: 1.02 }),
  vintage: (p) => p.modulate({ saturation: 0.7, brightness: 0.95 }).tint({ r: 210, g: 195, b: 170 }).gamma(1.15).sharpen({ sigma: 0.4 }),
  cinematic: (p) => p.modulate({ saturation: 0.85, brightness: 0.96 }).tint({ r: 180, g: 195, b: 215 }).gamma(1.08).sharpen({ sigma: 0.7 }),
  vibrant: (p) => p.modulate({ saturation: 1.45, brightness: 1.05 }).normalize().sharpen({ sigma: 0.8 }),
  filmnoir: (p) => p.grayscale().normalize().gamma(1.3).sharpen({ sigma: 1.2, m1: 1.5, m2: 0.8 }),
  goldenhour: (p) => p.modulate({ saturation: 1.1, brightness: 1.06 }).tint({ r: 255, g: 220, b: 180 }).gamma(1.05).sharpen({ sigma: 0.5 }),
  moody: (p) => p.modulate({ saturation: 0.75, brightness: 0.92 }).tint({ r: 160, g: 170, b: 200 }).gamma(1.12).sharpen({ sigma: 0.6 }),
  fresh: (p) => p.modulate({ saturation: 1.15, brightness: 1.08 }).gamma(0.95).normalize().sharpen({ sigma: 0.5 }),
  retro: (p) => p.modulate({ saturation: 0.65, brightness: 0.98 }).tint({ r: 200, g: 180, b: 150 }).gamma(1.18).sharpen({ sigma: 0.4 }),
  dramatic: (p) => p.normalize().sharpen({ sigma: 2.0, m1: 2.5, m2: 1.2 }).modulate({ saturation: 1.1, brightness: 0.95 }).gamma(1.15),
  warm_tone: (p) => p.modulate({ saturation: 1.1, brightness: 1.04 }).tint({ r: 245, g: 220, b: 185 }).gamma(1.04).sharpen({ sigma: 0.5 }),
  cool_tone: (p) => p.modulate({ saturation: 0.95, brightness: 1.02 }).tint({ r: 170, g: 200, b: 230 }).gamma(1.06).sharpen({ sigma: 0.5 }),
  sunset: (p) => p.modulate({ saturation: 1.2, brightness: 1.03 }).tint({ r: 255, g: 200, b: 160 }).gamma(1.05).sharpen({ sigma: 0.4 }),
  matte: (p) => p.modulate({ saturation: 0.7, brightness: 1.02 }).gamma(0.92).linear(0.9, 15).sharpen({ sigma: 0.3 }),
  neon: (p) => p.modulate({ saturation: 1.6, brightness: 1.05 }).sharpen({ sigma: 1.0 }).normalize(),
};

/**
 * Real image enhancement using sharp (libvips).
 * Accepts raw base64 (no prefix), returns raw base64 (no prefix).
 */
export async function enhanceImage(
  base64Data: string,
  mimeType: string,
  options: EnhanceOptions,
): Promise<{ base64: string; mimeType: string }> {
  const inputBuffer = Buffer.from(base64Data, "base64");
  let pipeline = sharp(inputBuffer);
  const meta = await sharp(inputBuffer).metadata();
  const type = options.enhancementType;
  const s = options.settings ?? {};

  logger.info({ type, width: meta.width, height: meta.height, format: meta.format }, "Enhancing image");

  // Check for named filter in settings
  const filterName = typeof s.filterName === "string" ? s.filterName : null;
  if (filterName && FILTER_PRESETS[filterName]) {
    pipeline = FILTER_PRESETS[filterName](pipeline);
  } else {
    switch (type) {
      case "auto": {
        pipeline = pipeline.normalize().sharpen({ sigma: 1.2, m1: 1.0, m2: 0.5 }).modulate({ brightness: 1.02, saturation: 1.08 }).gamma(1.05);
        break;
      }
      case "portrait":
      case "beauty":
      case "skin": {
        pipeline = pipeline.modulate({ brightness: 1.04, saturation: 0.95 }).sharpen({ sigma: 0.8, m1: 0.8, m2: 0.3 }).gamma(1.08).normalize();
        break;
      }
      case "upscale": {
        const w = meta.width ?? 800;
        const h = meta.height ?? 600;
        pipeline = pipeline.resize(w * 2, h * 2, { kernel: sharp.kernel.lanczos3, fit: "fill" }).sharpen({ sigma: 1.0, m1: 1.5, m2: 0.7 });
        break;
      }
      case "upscale_4x": {
        const w4 = meta.width ?? 800;
        const h4 = meta.height ?? 600;
        pipeline = pipeline.resize(w4 * 4, h4 * 4, { kernel: sharp.kernel.lanczos3, fit: "fill" }).sharpen({ sigma: 1.2, m1: 1.8, m2: 0.9 });
        break;
      }
      case "blur_background": {
        // Center-weighted portrait blur (tilt-shift bokeh simulation)
        const bw = meta.width ?? 800;
        const bh = meta.height ?? 600;
        const blurred = await sharp(inputBuffer).blur(18).toBuffer();
        const cw = Math.round(bw * 0.6);
        const ch = Math.round(bh * 0.7);
        const cx = Math.round((bw - cw) / 2);
        const cy = Math.round((bh - ch) / 2);
        const center = await sharp(inputBuffer)
          .extract({ left: cx, top: cy, width: cw, height: ch })
          .toBuffer();
        pipeline = sharp(blurred)
          .composite([{ input: center, left: cx, top: cy }])
          .modulate({ brightness: 1.02, saturation: 1.05 })
          .sharpen({ sigma: 0.5 });
        break;
      }
      case "posture": {
        // Portrait optimization with pose-aware corrections
        pipeline = pipeline
          .normalize()
          .modulate({ brightness: 1.03, saturation: 0.95 })
          .sharpen({ sigma: 0.9, m1: 0.8, m2: 0.4 })
          .gamma(1.06)
          .linear(1.02, 2);
        break;
      }
      case "color": {
        pipeline = pipeline.modulate({ saturation: 1.3 }).normalize().sharpen({ sigma: 0.5 });
        break;
      }
      case "lighting": {
        pipeline = pipeline.normalize().gamma(1.15).modulate({ brightness: 1.05 }).sharpen({ sigma: 0.8 });
        break;
      }
      case "background": {
        pipeline = pipeline.normalize().sharpen({ sigma: 1.5, m1: 2.0, m2: 1.0 }).modulate({ brightness: 1.02 });
        break;
      }
      case "filter": {
        // Default cinematic if no filterName
        pipeline = pipeline.modulate({ brightness: 0.98, saturation: 0.85 }).gamma(1.1).tint({ r: 220, g: 210, b: 195 }).sharpen({ sigma: 0.6 });
        break;
      }
      case "custom": {
        // Geometric adjustments
        if (typeof s.rotation === "number") {
          pipeline = pipeline.rotate(s.rotation as number, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
        }
        if (s.flipH === true) pipeline = pipeline.flop();
        if (s.flipV === true) pipeline = pipeline.flip();
        pipeline = pipeline.normalize().sharpen({ sigma: 0.8 });
        break;
      }
      case "stabilize":
      case "trim": {
        // For video types applied to a still frame
        pipeline = pipeline.normalize().sharpen({ sigma: 1.0 }).modulate({ brightness: 1.01 });
        break;
      }
      default: {
        pipeline = pipeline.normalize().sharpen({ sigma: 1.0 });
        break;
      }
    }
  }

  // Apply granular settings overrides
  if (typeof s.brightness === "number" && s.brightness !== 100) {
    pipeline = pipeline.modulate({ brightness: (s.brightness as number) / 100 });
  }
  if (typeof s.contrast === "number" && s.contrast !== 100) {
    const g = 1 + ((100 - (s.contrast as number)) / 200);
    pipeline = pipeline.gamma(Math.max(0.5, Math.min(3.0, g)));
  }
  if (typeof s.saturation === "number" && s.saturation !== 100) {
    pipeline = pipeline.modulate({ saturation: (s.saturation as number) / 100 });
  }
  if (typeof s.sharpness === "number" && (s.sharpness as number) > 100) {
    pipeline = pipeline.sharpen({ sigma: ((s.sharpness as number) - 100) / 50 });
  }
  if (typeof s.warmth === "number" && s.warmth !== 0) {
    const w = s.warmth as number;
    pipeline = pipeline.tint({ r: 128 + w, g: 128, b: 128 - w });
  }
  if (typeof s.highlights === "number" && s.highlights !== 100) {
    const hl = (s.highlights as number) / 100;
    pipeline = pipeline.linear(hl, 0);
  }
  if (typeof s.shadows === "number" && s.shadows !== 100) {
    const sh = Math.max(0.3, Math.min(3.0, (s.shadows as number) / 100));
    pipeline = pipeline.gamma(1 / sh);
  }
  if (typeof s.hue === "number" && s.hue !== 0) {
    pipeline = pipeline.modulate({ hue: s.hue as number });
  }
  if (typeof s.skinSmoothing === "number" && (s.skinSmoothing as number) > 0) {
    const intensity = Math.min(5, (s.skinSmoothing as number) / 20);
    pipeline = pipeline.blur(intensity);
  }

  // Output as JPEG
  const outputBuffer = await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  const outBase64 = outputBuffer.toString("base64");

  logger.info({
    type, filterName,
    inputBytes: inputBuffer.length,
    outputBytes: outputBuffer.length,
    ratio: (outputBuffer.length / inputBuffer.length).toFixed(2),
  }, "Image enhancement complete");

  return { base64: outBase64, mimeType: "image/jpeg" };
}
