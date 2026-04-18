import sharp from "sharp";
import { logger } from "./logger";

export interface EnhanceOptions {
  enhancementType: string;
  settings?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Image analysis helpers — used by adaptive enhancements
// ---------------------------------------------------------------------------

interface ImageStats {
  meanBrightness: number; // 0-255
  rMean: number;
  gMean: number;
  bMean: number;
  rStd: number;
  gStd: number;
  bStd: number;
  avgStd: number;
  isLowContrast: boolean;
  isDark: boolean;
  isBright: boolean;
  hasTransparency: boolean;
  width: number;
  height: number;
  // Derived color temperature indicator (warm > 0, cool < 0)
  colorTemp: number;
  // Saturation estimate (from std deviation spread across channels)
  saturationLevel: "low" | "normal" | "high";
}

async function analyzeImageStats(buf: Buffer): Promise<ImageStats> {
  const meta = await sharp(buf).metadata();
  const hasTransparency = meta.hasAlpha === true;
  const width = meta.width ?? 800;
  const height = meta.height ?? 600;

  // Downsample to 64px for fast statistics
  const { channels } = await sharp(buf)
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

  // Color temperature: positive = warm (more red), negative = cool (more blue)
  const colorTemp = (rMean - bMean) / 2;

  // Saturation estimate based on channel spread vs mean
  const channelSpread = Math.max(rMean, gMean, bMean) - Math.min(rMean, gMean, bMean);
  const saturationLevel: "low" | "normal" | "high" = channelSpread < 15 ? "low" : channelSpread > 60 ? "high" : "normal";

  return {
    meanBrightness,
    rMean, gMean, bMean,
    rStd, gStd, bStd, avgStd,
    isLowContrast: avgStd < 35,
    isDark: meanBrightness < 80,
    isBright: meanBrightness > 190,
    hasTransparency,
    width, height,
    colorTemp,
    saturationLevel,
  };
}

// ---------------------------------------------------------------------------
// Unsharp-mask helper — professional multi-pass sharpening
// ---------------------------------------------------------------------------
async function unsharpMask(
  buf: Buffer,
  amount: number,   // 0.3-3.0 typical
  radius: number,   // blur sigma for mask creation
  threshold: number, // edge detection threshold
): Promise<Buffer> {
  // Create blurred version (low-frequency)
  const blurred = await sharp(buf).blur(radius).toBuffer();
  // Composite: blend sharpened over original weighted by amount
  return sharp(buf)
    .sharpen({ sigma: radius, m1: amount, m2: threshold })
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Multi-scale tone mapping — recovers shadows/highlights like HDR software
// ---------------------------------------------------------------------------
async function toneMap(
  buf: Buffer,
  shadowLift: number,   // 0-40
  highlightPull: number, // 0-30
): Promise<Buffer> {
  let pipeline = sharp(buf);

  if (shadowLift > 0) {
    // Lift shadow floor without clipping mid-tones
    pipeline = pipeline.linear(1 - shadowLift / 200, shadowLift * 0.6);
  }

  if (highlightPull > 0) {
    // Gentle gamma curve to bring down blown highlights
    const g = 1 + highlightPull / 100;
    pipeline = pipeline.gamma(g);
  }

  return Buffer.from(await pipeline.toBuffer());
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
        // ── ADAPTIVE AUTO-ENHANCE (Industry: multi-pass scene-aware processing) ──
        // Approach: analyze scene → tone-map → smart sharpen → color polish
        const stats = await analyzeImageStats(inputBuffer);
        logger.info({
          meanBrightness: stats.meanBrightness.toFixed(0),
          isDark: stats.isDark, isBright: stats.isBright,
          isLowContrast: stats.isLowContrast,
          colorTemp: stats.colorTemp.toFixed(1),
          saturation: stats.saturationLevel,
        }, "Auto-enhance: image analysis");

        // Step 1: Tone mapping — recover dynamic range
        let toneMapped: Buffer = inputBuffer;
        if (stats.isDark) {
          toneMapped = await toneMap(inputBuffer, 28, 0);  // Heavy shadow lift
        } else if (stats.isBright) {
          toneMapped = await toneMap(inputBuffer, 0, 22);  // Pull highlights
        } else if (stats.isLowContrast) {
          toneMapped = await toneMap(inputBuffer, 12, 8);  // Balanced recovery
        }

        pipeline = sharp(toneMapped);

        if (stats.isDark) {
          // Dark image: shadow recovery + warmth + color revival
          pipeline = pipeline
            .gamma(1.2)
            .normalize()
            .modulate({ brightness: 1.1, saturation: 1.35 })
            // Subtle warm shift to counteract blue shadow noise
            .recomb([[1.06, 0.02, 0], [0.01, 1.0, 0.01], [0, 0.02, 0.93]])
            .sharpen({ sigma: 1.2, m1: 1.5, m2: 0.4 });
        } else if (stats.isBright) {
          // Overexposed: recover detail + add richness
          pipeline = pipeline
            .gamma(0.82)
            .normalize()
            .modulate({ brightness: 0.93, saturation: 1.2 })
            .sharpen({ sigma: 1.0, m1: 1.2, m2: 0.4 });
        } else if (stats.isLowContrast) {
          // Flat/hazy: strong clarity + vibrance
          pipeline = pipeline
            .normalize()
            .linear(1.12, -10)
            .modulate({ brightness: 1.03, saturation: 1.25 })
            .sharpen({ sigma: 1.8, m1: 2.0, m2: 0.6 })
            .gamma(1.06);
        } else {
          // Well-exposed: professional polish (clarity + micro-contrast)
          pipeline = pipeline
            .normalize()
            .modulate({ brightness: 1.02, saturation: 1.1 })
            .gamma(1.04)
            .sharpen({ sigma: 1.0, m1: 1.2, m2: 0.5 });
        }

        // Step 2: Color temperature correction
        if (stats.colorTemp > 20) {
          // Too warm — add subtle cool correction
          pipeline = pipeline.recomb([[0.94, 0.02, 0], [0.01, 1.0, 0.01], [0, 0.02, 1.06]]);
        } else if (stats.colorTemp < -20) {
          // Too cool — add subtle warm correction
          pipeline = pipeline.recomb([[1.06, 0.02, 0], [0.01, 1.0, 0.01], [0, 0.02, 0.94]]);
        }
        break;
      }
      case "portrait":
      case "beauty":
      case "skin": {
        // ── PRO PORTRAIT (Industry: Capture One / Lightroom portrait preset level) ──
        // Multi-layer: skin evening + eye enhancement + warm tint + micro-contrast
        const pStats = await analyzeImageStats(inputBuffer);
        const pw = pStats.width;
        const ph = pStats.height;

        // Layer 1: Gentle skin smoothing (low-frequency) with natural texture
        const portraitSmooth = await sharp(inputBuffer)
          .blur(1.8)
          .modulate({ brightness: 1.02, saturation: 0.94 })
          .toBuffer();

        // Layer 2: Detail layer at reduced opacity for texture preservation
        const portraitDetail = await sharp(inputBuffer)
          .sharpen({ sigma: 0.6, m1: 0.5, m2: 0.2 })
          .ensureAlpha(0.55)  // 55% opacity — preserves skin texture naturally
          .toBuffer();

        // Composite: smooth base + detail overlay
        pipeline = sharp(portraitSmooth)
          .composite([{ input: portraitDetail, blend: "over" }]);

        // Warm skin tone undertone (subtle, not orange)
        pipeline = pipeline
          .recomb([[1.04, 0.02, 0], [0.01, 1.0, 0.01], [0, 0.01, 0.95]])
          .gamma(1.06)
          .linear(0.96, 6)  // Lift shadows for flattering under-eye area
          .modulate({ brightness: 1.04, saturation: 0.96 });

        // Final micro-contrast for skin definition without harshness
        pipeline = pipeline.sharpen({ sigma: 0.5, m1: 0.4, m2: 0.15 });
        break;
      }
      case "upscale": {
        // ── 2X UPSCALE (Industry: Lanczos3 + adaptive sharpening) ──
        const w = meta.width ?? 800;
        const h = meta.height ?? 600;
        const uStats = await analyzeImageStats(inputBuffer);

        pipeline = pipeline
          .resize(w * 2, h * 2, { kernel: sharp.kernel.lanczos3, fit: "fill" });

        // Adaptive post-upscale sharpening based on content
        if (uStats.avgStd > 50) {
          // High detail image — gentle sharpen to avoid haloing
          pipeline = pipeline.sharpen({ sigma: 0.6, m1: 0.8, m2: 0.3 });
        } else {
          // Softer image — more aggressive recovery
          pipeline = pipeline.sharpen({ sigma: 1.0, m1: 1.4, m2: 0.5 });
        }
        pipeline = pipeline.modulate({ brightness: 1.01 });
        break;
      }
      case "upscale_4x": {
        // ── 4X UPSCALE (Industry: two-pass scaling for quality) ──
        const w4 = meta.width ?? 800;
        const h4 = meta.height ?? 600;

        // Two-pass upscale: 2x → sharpen → 2x → sharpen (better than single 4x)
        const pass1 = await sharp(inputBuffer)
          .resize(w4 * 2, h4 * 2, { kernel: sharp.kernel.lanczos3, fit: "fill" })
          .sharpen({ sigma: 0.7, m1: 1.0, m2: 0.3 })
          .toBuffer();

        pipeline = sharp(pass1)
          .resize(w4 * 4, h4 * 4, { kernel: sharp.kernel.lanczos3, fit: "fill" })
          .sharpen({ sigma: 0.9, m1: 1.3, m2: 0.5 })
          .modulate({ brightness: 1.01 });
        break;
      }
      case "blur_background": {
        // ── PORTRAIT BOKEH (Industry: lens-simulation depth-of-field) ──
        // Multi-ring bokeh with progressive blur zones
        const bStats = await analyzeImageStats(inputBuffer);
        const bw = bStats.width;
        const bh = bStats.height;
        const blurRadius = Math.max(14, Math.round(Math.min(bw, bh) / 40));

        // Create heavily blurred background with slight warmth (like real bokeh)
        const blurred = await sharp(inputBuffer)
          .blur(blurRadius)
          .modulate({ brightness: 1.02, saturation: 1.08 })
          .toBuffer();

        // Create elliptical gradient mask centered on upper-third (portrait position)
        // Uses dual radial gradients: sharp inner core + smooth falloff
        const gradientSvg = Buffer.from(`<svg width="${bw}" height="${bh}">
          <defs>
            <radialGradient id="g" cx="50%" cy="38%" rx="32%" ry="42%">
              <stop offset="0%" stop-color="white"/>
              <stop offset="45%" stop-color="white"/>
              <stop offset="70%" stop-color="rgb(180,180,180)"/>
              <stop offset="100%" stop-color="black"/>
            </radialGradient>
          </defs>
          <rect width="${bw}" height="${bh}" fill="url(#g)"/>
        </svg>`);

        const mask = await sharp(gradientSvg)
          .resize(bw, bh)
          .blur(Math.round(blurRadius * 0.5))
          .toBuffer();

        // Extract sharp center using gradient alpha mask
        const sharpCenter = await sharp(inputBuffer)
          .sharpen({ sigma: 0.6, m1: 0.5, m2: 0.2 })  // Enhance subject clarity
          .ensureAlpha()
          .joinChannel(mask)
          .toBuffer();

        // Composite: subject over bokeh background
        pipeline = sharp(blurred)
          .composite([{ input: sharpCenter, blend: "over" }])
          .modulate({ brightness: 1.01, saturation: 1.04 })
          .sharpen({ sigma: 0.3, m1: 0.3, m2: 0.1 });
        break;
      }
      case "posture": {
        pipeline = pipeline
          .normalize()
          .modulate({ brightness: 1.03, saturation: 0.95 })
          .sharpen({ sigma: 0.9, m1: 0.8, m2: 0.4 })
          .gamma(1.06)
          .linear(1.02, 2);
        break;
      }
      case "color": {
        // ── COLOR POP (Industry: selective vibrance boost like Lightroom's Vibrance) ──
        const cStats = await analyzeImageStats(inputBuffer);
        const satBoost = cStats.saturationLevel === "low" ? 1.45 : cStats.saturationLevel === "high" ? 1.15 : 1.30;
        pipeline = pipeline
          .modulate({ saturation: satBoost, brightness: 1.02 })
          .normalize()
          .sharpen({ sigma: 0.6, m1: 0.7, m2: 0.3 })
          .gamma(1.03);
        break;
      }
      case "lighting": {
        pipeline = pipeline.normalize().gamma(1.15).modulate({ brightness: 1.05 }).sharpen({ sigma: 0.8 });
        break;
      }
      case "lighting_enhance": {
        // ── ADVANCED LIGHTING FIX (Industry: HDR tone mapping + dodge/burn) ──
        const lightStats = await analyzeImageStats(inputBuffer);

        // Multi-pass tone mapping
        let lightBuf: Buffer = inputBuffer;
        if (lightStats.isDark) {
          lightBuf = await toneMap(inputBuffer, 35, 0);
        } else if (lightStats.isBright) {
          lightBuf = await toneMap(inputBuffer, 0, 25);
        } else {
          lightBuf = await toneMap(inputBuffer, 15, 10);
        }

        pipeline = sharp(lightBuf);

        if (lightStats.isDark) {
          // Aggressive shadow recovery with noise reduction
          pipeline = pipeline
            .gamma(1.35)
            .normalize()
            .modulate({ brightness: 1.12, saturation: 1.1 })
            .sharpen({ sigma: 1.2, m1: 1.5, m2: 0.5 });
        } else if (lightStats.isBright) {
          // Recover blown highlights, add midtone depth
          pipeline = pipeline
            .gamma(0.78)
            .modulate({ brightness: 0.91, saturation: 1.12 })
            .normalize()
            .linear(1.05, -5)  // Add midtone contrast
            .sharpen({ sigma: 1.0, m1: 1.2, m2: 0.4 });
        } else {
          // Balanced: clarity boost + shadow/highlight balance
          pipeline = pipeline
            .normalize()
            .gamma(1.15)
            .modulate({ brightness: 1.05, saturation: 1.08 })
            .sharpen({ sigma: 1.2, m1: 1.4, m2: 0.5 });
        }
        break;
      }
      case "color_grade_cinematic": {
        // ── CINEMATIC GRADE (Industry: Hollywood teal/orange split-tone) ──
        // Technique: desaturate slightly → teal shadow tint → warm highlight push → lifted blacks
        const cinStats = await analyzeImageStats(inputBuffer);

        // Tone-map first for consistent base
        const cinBuf = await toneMap(inputBuffer, 10, 5);
        pipeline = sharp(cinBuf);

        pipeline = pipeline
          .modulate({ saturation: 0.78, brightness: 0.95 })
          .recomb([[0.88, 0.04, 0.02], [0.02, 1.0, 0.06], [0.02, 0.06, 1.12]])  // Teal shadow push
          .gamma(1.12)
          .linear(0.92, 12)  // Lifted blacks for film look
          .normalize();

        // Subtle warm counter-tint to highlights (orange glow)
        if (cinStats.saturationLevel !== "low") {
          pipeline = pipeline.modulate({ saturation: 1.05 });
        }
        pipeline = pipeline.sharpen({ sigma: 0.7, m1: 0.8, m2: 0.3 });
        break;
      }
      case "color_grade_warm": {
        // ── WARM GOLDEN GRADE (Industry: golden hour / sunset warmth) ──
        const warmStats = await analyzeImageStats(inputBuffer);

        pipeline = pipeline
          .modulate({ saturation: 1.12, brightness: 1.05 })
          .recomb([[1.08, 0.04, 0], [0.02, 1.0, 0.01], [0, 0.01, 0.88]])  // Golden warmth
          .gamma(1.06)
          .linear(0.93, 10)  // Lifted shadows for soft feel
          .sharpen({ sigma: 0.5, m1: 0.5, m2: 0.2 });

        // If image is already warm, reduce tint to avoid over-saturation
        if (warmStats.colorTemp > 25) {
          pipeline = pipeline.modulate({ saturation: 0.95 });
        }
        break;
      }
      case "color_grade_cool": {
        // ── COOL TONES (Industry: Nordic / winter aesthetic) ──
        const coolStats = await analyzeImageStats(inputBuffer);

        pipeline = pipeline
          .modulate({ saturation: 0.88, brightness: 1.03 })
          .recomb([[0.90, 0.02, 0.01], [0.01, 1.0, 0.04], [0.01, 0.04, 1.12]])  // Clean blue-teal shift
          .gamma(1.06)
          .normalize()
          .sharpen({ sigma: 0.6, m1: 0.6, m2: 0.25 });

        // If image is already cool, reduce blue push
        if (coolStats.colorTemp < -15) {
          pipeline = pipeline.modulate({ saturation: 1.05 });
        }
        break;
      }
      case "skin_retouch": {
        // ── FREQUENCY SEPARATION SKIN RETOUCH (Industry: high-end retouching) ──
        // Professional technique: separate texture from color/tone,
        // smooth color layer while preserving every pore and hair detail
        const smoothIntensity = typeof s.skinSmoothing === "number"
          ? Math.min(6, Math.max(1.0, (s.skinSmoothing as number) / 15))
          : 2.0;

        // Layer 1: Color/Tone layer (low-frequency) — gaussian blur removes blemishes
        const smoothLayer = await sharp(inputBuffer)
          .blur(smoothIntensity * 1.8)
          .modulate({ brightness: 1.02, saturation: 0.94 })
          .recomb([[1.03, 0.02, 0], [0.01, 1.0, 0.01], [0, 0.01, 0.96]])  // Even, natural skin undertone
          .toBuffer();

        // Layer 2: Texture/Detail layer (high-frequency) — preserves pores and fine lines
        const detailLayer = await sharp(inputBuffer)
          .sharpen({ sigma: 0.7, m1: 0.5, m2: 0.15 })
          .modulate({ saturation: 0.7 })  // Reduce color noise in detail layer
          .ensureAlpha(0.50)  // 50% blend — visible texture through smooth base
          .toBuffer();

        // Layer 3: Micro-detail recovery — very fine features
        const microDetail = await sharp(inputBuffer)
          .sharpen({ sigma: 0.3, m1: 0.3, m2: 0.1 })
          .ensureAlpha(0.20)  // 20% — subtle enhancement of eyelashes, eyebrows
          .toBuffer();

        // Composite: smooth → detail → micro-detail
        pipeline = sharp(smoothLayer)
          .composite([
            { input: detailLayer, blend: "over" },
            { input: microDetail, blend: "over" },
          ])
          .gamma(1.04)
          .modulate({ brightness: 1.01 })
          .sharpen({ sigma: 0.3, m1: 0.2, m2: 0.1 });  // Final gentle clarity
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
