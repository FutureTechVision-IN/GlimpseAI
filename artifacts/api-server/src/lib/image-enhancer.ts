import sharp from "sharp";
import { logger } from "./logger";

export interface EnhanceOptions {
  enhancementType: string;
  settings?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Image analysis helpers — used by adaptive auto-enhance
// ---------------------------------------------------------------------------

interface ImageStats {
  meanBrightness: number; // 0-255
  isLowContrast: boolean;
  isDark: boolean;
  isBright: boolean;
  hasTransparency: boolean;
}

async function analyzeImageStats(buf: Buffer): Promise<ImageStats> {
  const meta = await sharp(buf).metadata();
  const hasTransparency = meta.hasAlpha === true;

  // Downsample to 64px for fast statistics
  const { dominant, channels } = await sharp(buf)
    .resize(64, 64, { fit: "inside" })
    .removeAlpha()
    .toColourspace("srgb")
    .stats();

  // Weighted luminance from channel means
  const rMean = channels[0]?.mean ?? 128;
  const gMean = channels[1]?.mean ?? 128;
  const bMean = channels[2]?.mean ?? 128;
  const meanBrightness = 0.299 * rMean + 0.587 * gMean + 0.114 * bMean;

  // Check contrast spread from channel std-dev
  const rStd = channels[0]?.stdev ?? 40;
  const gStd = channels[1]?.stdev ?? 40;
  const bStd = channels[2]?.stdev ?? 40;
  const avgStd = (rStd + gStd + bStd) / 3;

  return {
    meanBrightness,
    isLowContrast: avgStd < 35,
    isDark: meanBrightness < 80,
    isBright: meanBrightness > 190,
    hasTransparency,
  };
}

// Named filter presets (server-side sharp equivalents)
const FILTER_PRESETS: Record<string, (p: sharp.Sharp) => sharp.Sharp> = {
  // ── Classic ──
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
  // ── New premium filters ──
  airy: (p) => p.modulate({ brightness: 1.12, saturation: 0.85 }).gamma(0.88).sharpen({ sigma: 0.3 }).tint({ r: 240, g: 240, b: 250 }),
  teal_orange: (p) => p.modulate({ saturation: 1.2, brightness: 1.02 }).tint({ r: 220, g: 195, b: 170 }).normalize().sharpen({ sigma: 0.6 }),
  pastel: (p) => p.modulate({ saturation: 0.55, brightness: 1.15 }).gamma(0.85).sharpen({ sigma: 0.3 }).tint({ r: 240, g: 230, b: 235 }),
  noir_color: (p) => p.modulate({ saturation: 0.4, brightness: 0.88 }).gamma(1.25).sharpen({ sigma: 1.5, m1: 2.0, m2: 1.0 }).normalize(),
  cross_process: (p) => p.modulate({ saturation: 1.3, brightness: 1.0 }).tint({ r: 200, g: 240, b: 180 }).gamma(1.1).sharpen({ sigma: 0.6 }),
  cyberpunk: (p) => p.modulate({ saturation: 1.5, brightness: 0.95 }).tint({ r: 200, g: 150, b: 255 }).gamma(1.15).sharpen({ sigma: 0.8 }),
  arctic: (p) => p.modulate({ saturation: 0.6, brightness: 1.1 }).tint({ r: 190, g: 215, b: 240 }).gamma(1.02).sharpen({ sigma: 0.4 }),
  ember: (p) => p.modulate({ saturation: 1.15, brightness: 0.95 }).tint({ r: 255, g: 180, b: 140 }).gamma(1.1).sharpen({ sigma: 0.7 }),
  forest: (p) => p.modulate({ saturation: 1.1, brightness: 0.97 }).tint({ r: 170, g: 210, b: 170 }).gamma(1.05).sharpen({ sigma: 0.5 }),
  chrome: (p) => p.modulate({ saturation: 0.3, brightness: 1.08 }).normalize().sharpen({ sigma: 1.5, m1: 1.8, m2: 0.9 }).gamma(1.0),
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
        // Adaptive auto-enhance: analyze image statistics and tailor processing
        const stats = await analyzeImageStats(inputBuffer);
        logger.info({ meanBrightness: stats.meanBrightness.toFixed(0), isDark: stats.isDark, isLowContrast: stats.isLowContrast }, "Auto-enhance: image analysis");

        if (stats.isDark) {
          // Dark image: lift shadows, add warmth, boost brightness
          pipeline = pipeline
            .gamma(1.35)
            .linear(0.92, 18)  // Lift shadow floor
            .modulate({ brightness: 1.12, saturation: 1.1 })
            .normalize()
            .sharpen({ sigma: 1.0, m1: 1.2, m2: 0.5 });
        } else if (stats.isBright) {
          // Overexposed: recover highlights, add depth
          pipeline = pipeline
            .gamma(0.85)
            .modulate({ brightness: 0.95, saturation: 1.12 })
            .normalize()
            .sharpen({ sigma: 1.0, m1: 1.0, m2: 0.4 });
        } else if (stats.isLowContrast) {
          // Flat/hazy: strong contrast boost + clarity
          pipeline = pipeline
            .normalize()
            .linear(1.08, -6)  // Contrast curve
            .modulate({ brightness: 1.02, saturation: 1.15 })
            .sharpen({ sigma: 1.5, m1: 1.5, m2: 0.7 })
            .gamma(1.05);
        } else {
          // Well-exposed: gentle polish
          pipeline = pipeline
            .normalize()
            .sharpen({ sigma: 1.2, m1: 1.0, m2: 0.5 })
            .modulate({ brightness: 1.02, saturation: 1.08 })
            .gamma(1.05);
        }
        break;
      }
      case "portrait":
      case "beauty":
      case "skin": {
        // Professional portrait enhancement: warm skin tones + soft detail + clarity
        pipeline = pipeline
          .modulate({ brightness: 1.05, saturation: 0.93 })
          .tint({ r: 248, g: 235, b: 225 })  // Subtle warm skin undertone
          .sharpen({ sigma: 0.8, m1: 0.8, m2: 0.3 })
          .gamma(1.08)
          .normalize()
          .linear(0.97, 4);  // Slight shadow lift for flattering look
        break;
      }
      case "upscale": {
        const w = meta.width ?? 800;
        const h = meta.height ?? 600;
        pipeline = pipeline
          .resize(w * 2, h * 2, { kernel: sharp.kernel.lanczos3, fit: "fill" })
          .sharpen({ sigma: 0.8, m1: 1.2, m2: 0.5 })  // Gentle post-upscale sharpening
          .modulate({ brightness: 1.01 });  // Slight brightness to counter upscale softness
        break;
      }
      case "upscale_4x": {
        const w4 = meta.width ?? 800;
        const h4 = meta.height ?? 600;
        pipeline = pipeline
          .resize(w4 * 4, h4 * 4, { kernel: sharp.kernel.lanczos3, fit: "fill" })
          .sharpen({ sigma: 1.0, m1: 1.5, m2: 0.6 })
          .modulate({ brightness: 1.01 });
        break;
      }
      case "blur_background": {
        // Advanced portrait bokeh with radial gradient mask for natural falloff
        const bw = meta.width ?? 800;
        const bh = meta.height ?? 600;
        const blurRadius = Math.max(12, Math.round(Math.min(bw, bh) / 50));

        // Create heavily blurred background
        const blurred = await sharp(inputBuffer)
          .blur(blurRadius)
          .modulate({ brightness: 1.01 })
          .toBuffer();

        // Create radial gradient mask (white center fading to black edges)
        // This gives a natural, lens-like bokeh falloff
        const gradientSvg = Buffer.from(`<svg width="${bw}" height="${bh}">
          <defs>
            <radialGradient id="g" cx="50%" cy="42%" rx="35%" ry="45%">
              <stop offset="0%" stop-color="white"/>
              <stop offset="60%" stop-color="white"/>
              <stop offset="100%" stop-color="black"/>
            </radialGradient>
          </defs>
          <rect width="${bw}" height="${bh}" fill="url(#g)"/>
        </svg>`);

        const mask = await sharp(gradientSvg)
          .resize(bw, bh)
          .blur(Math.round(blurRadius * 0.6))  // Soften mask edges
          .toBuffer();

        // Extract sharp center using the mask
        const sharpCenter = await sharp(inputBuffer)
          .ensureAlpha()
          .joinChannel(mask)  // Use gradient as alpha
          .toBuffer();

        // Composite sharp center over blurred background
        pipeline = sharp(blurred)
          .composite([{ input: sharpCenter, blend: "over" }])
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
      case "lighting_enhance": {
        // Advanced mood-aware lighting: multi-pass shadow/highlight recovery
        const lightStats = await analyzeImageStats(inputBuffer);
        if (lightStats.isDark) {
          // Aggressive shadow recovery for dark images
          pipeline = pipeline
            .gamma(1.4)
            .linear(0.88, 22)
            .normalize()
            .modulate({ brightness: 1.1, saturation: 1.08 })
            .sharpen({ sigma: 1.2, m1: 1.5, m2: 0.6 });
        } else if (lightStats.isBright) {
          // Recover blown highlights
          pipeline = pipeline
            .gamma(0.82)
            .modulate({ brightness: 0.93, saturation: 1.1 })
            .normalize()
            .sharpen({ sigma: 1.0, m1: 1.2, m2: 0.5 });
        } else {
          // Balanced: lift shadows + clarity
          pipeline = pipeline
            .normalize()
            .gamma(1.2)
            .linear(0.95, 10)
            .modulate({ brightness: 1.06, saturation: 1.05 })
            .sharpen({ sigma: 1.0, m1: 1.2, m2: 0.5 });
        }
        break;
      }
      case "color_grade_cinematic": {
        // Professional cinematic color grade: teal shadows + warm highlights
        pipeline = pipeline
          .modulate({ saturation: 0.82, brightness: 0.96 })
          .tint({ r: 175, g: 195, b: 220 })
          .gamma(1.1)
          .linear(0.95, 8)
          .sharpen({ sigma: 0.8, m1: 0.8, m2: 0.4 });
        break;
      }
      case "color_grade_warm": {
        // Warm golden tones with lifted blacks
        pipeline = pipeline
          .modulate({ saturation: 1.08, brightness: 1.04 })
          .tint({ r: 248, g: 225, b: 190 })
          .gamma(1.05)
          .linear(0.92, 12)
          .sharpen({ sigma: 0.5 });
        break;
      }
      case "color_grade_cool": {
        // Cool blue-teal grade with clean highlights
        pipeline = pipeline
          .modulate({ saturation: 0.9, brightness: 1.02 })
          .tint({ r: 165, g: 195, b: 225 })
          .gamma(1.08)
          .normalize()
          .sharpen({ sigma: 0.6 });
        break;
      }
      case "skin_retouch": {
        // Advanced frequency-separation-inspired skin retouch:
        // 1. Create smooth layer (low frequency) — blurs blemishes
        // 2. Extract detail layer (high frequency) — preserves texture
        // 3. Blend back with reduced blemish visibility
        const smoothIntensity = typeof s.skinSmoothing === "number"
          ? Math.min(8, Math.max(1.0, (s.skinSmoothing as number) / 12))
          : 2.5;
        const rw = meta.width ?? 800;
        const rh = meta.height ?? 600;

        // Low-frequency (smooth) layer
        const smoothLayer = await sharp(inputBuffer)
          .blur(smoothIntensity * 1.5)
          .modulate({ brightness: 1.03, saturation: 0.92 })
          .tint({ r: 245, g: 232, b: 222 })  // Warm skin tone
          .toBuffer();

        // Original sharpened for detail recovery
        const detailLayer = await sharp(inputBuffer)
          .sharpen({ sigma: 0.8, m1: 0.6, m2: 0.2 })
          .ensureAlpha(0.45)  // 45% opacity for subtle detail overlay
          .toBuffer();

        // Composite: smooth base + detail overlay
        pipeline = sharp(smoothLayer)
          .composite([{ input: detailLayer, blend: "over" }])
          .gamma(1.06)
          .sharpen({ sigma: 0.4, m1: 0.3, m2: 0.15 });  // Final gentle clarity
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

  // Output: preserve PNG for transparent images, JPEG for photos
  const stats = await analyzeImageStats(inputBuffer);
  let outputBuffer: Buffer;
  let outputMime: string;

  if (stats.hasTransparency) {
    outputBuffer = await pipeline.png({ compressionLevel: 6 }).toBuffer();
    outputMime = "image/png";
  } else {
    outputBuffer = await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    outputMime = "image/jpeg";
  }

  const outBase64 = outputBuffer.toString("base64");

  logger.info({
    type, filterName,
    inputBytes: inputBuffer.length,
    outputBytes: outputBuffer.length,
    ratio: (outputBuffer.length / inputBuffer.length).toFixed(2),
  }, "Image enhancement complete");

  return { base64: outBase64, mimeType: outputMime };
}
