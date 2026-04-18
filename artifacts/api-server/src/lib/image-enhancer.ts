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
  tealandorange: (p) => p.modulate({ saturation: 1.15, brightness: 1.0 }).tint({ r: 200, g: 165, b: 140 }).normalize().sharpen({ sigma: 0.7 }),
  pastel: (p) => p.modulate({ saturation: 0.55, brightness: 1.12 }).gamma(0.9).sharpen({ sigma: 0.3 }),
  crossprocess: (p) => p.modulate({ saturation: 1.2, brightness: 1.0 }).tint({ r: 140, g: 200, b: 170 }).gamma(1.1).sharpen({ sigma: 0.6 }),
  warmth: (p) => p.modulate({ saturation: 1.08, brightness: 1.05 }).tint({ r: 245, g: 215, b: 185 }).sharpen({ sigma: 0.4 }),
  coolbreeze: (p) => p.modulate({ saturation: 0.9, brightness: 1.04 }).tint({ r: 170, g: 195, b: 230 }).gamma(1.04).sharpen({ sigma: 0.5 }),
  faded: (p) => p.modulate({ saturation: 0.6, brightness: 1.08 }).gamma(0.92).sharpen({ sigma: 0.3 }),
  matte: (p) => p.modulate({ saturation: 0.8, brightness: 1.02 }).gamma(0.88).sharpen({ sigma: 0.4 }),
};

/**
 * Create a vignette overlay and composite onto the pipeline.
 * Uses a radial gradient rendered as SVG.
 */
async function applyVignette(pipeline: sharp.Sharp, meta: sharp.Metadata, intensity: number): Promise<sharp.Sharp> {
  const w = meta.width ?? 800;
  const h = meta.height ?? 600;
  const opacity = Math.min(1, Math.max(0, intensity / 100)) * 0.7;
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="v" cx="50%" cy="50%" r="70%">
        <stop offset="50%" stop-color="black" stop-opacity="0"/>
        <stop offset="100%" stop-color="black" stop-opacity="${opacity}"/>
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#v)"/>
  </svg>`;
  const overlay = await sharp(Buffer.from(svg)).png().toBuffer();
  return pipeline.composite([{ input: overlay, blend: "over" }]);
}

/**
 * Apply a grain/noise overlay to simulate film grain.
 */
async function applyGrain(pipeline: sharp.Sharp, meta: sharp.Metadata, intensity: number): Promise<sharp.Sharp> {
  const w = meta.width ?? 800;
  const h = meta.height ?? 600;
  const grainBuffer = await sharp({
    create: { width: w, height: h, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 1 } },
  })
    .png()
    .toBuffer();
  // Add noise via blur at very small sigma then normalize for texture
  const noise = await sharp(grainBuffer)
    .blur(0.5)
    .modulate({ brightness: 1.0 + (intensity / 500) })
    .ensureAlpha(intensity / 250)
    .png()
    .toBuffer();
  return pipeline.composite([{ input: noise, blend: "soft-light" }]);
}

/**
 * Create a thumbnail for AI analysis.
 */
export async function createThumbnail(base64Data: string): Promise<{ base64: string; mimeType: string }> {
  const inputBuffer = Buffer.from(base64Data, "base64");
  const thumbBuffer = await sharp(inputBuffer)
    .resize(512, 512, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer();
  return { base64: thumbBuffer.toString("base64"), mimeType: "image/jpeg" };
}

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
      case "portrait": {
        // Enhanced portrait with skin smoothing via controlled blur + sharpen
        pipeline = pipeline
          .modulate({ brightness: 1.05, saturation: 0.93 })
          .blur(0.5) // Subtle skin smoothing
          .sharpen({ sigma: 0.9, m1: 0.8, m2: 0.3 })
          .gamma(1.08)
          .normalize();
        break;
      }
      case "beauty": {
        // Heavier beauty processing with warm tones
        pipeline = pipeline
          .modulate({ brightness: 1.06, saturation: 0.88 })
          .blur(0.8) // Stronger skin smoothing
          .sharpen({ sigma: 0.6, m1: 0.5, m2: 0.2 })
          .gamma(1.1)
          .tint({ r: 240, g: 220, b: 210 })
          .normalize();
        break;
      }
      case "skin": {
        // Dedicated skin retouching
        const intensity = typeof s.retouchIntensity === "number" ? s.retouchIntensity : 50;
        const blurSigma = 0.3 + (intensity / 100) * 1.2;
        pipeline = pipeline
          .modulate({ brightness: 1.03, saturation: 0.95 })
          .blur(blurSigma)
          .sharpen({ sigma: 0.7, m1: 0.6, m2: 0.2 })
          .gamma(1.06)
          .normalize();
        break;
      }
      case "upscale": {
        const w = meta.width ?? 800;
        const h = meta.height ?? 600;
        const scale = (typeof s.scale === "number" && s.scale === 4) ? 4 : 2;
        pipeline = pipeline
          .resize(w * scale, h * scale, { kernel: sharp.kernel.lanczos3, fit: "fill" })
          .sharpen({ sigma: 1.0 + (scale === 4 ? 0.5 : 0), m1: 1.5, m2: 0.7 });
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
        // Simulate background blur effect (full-image approach — true segmentation needs ML models)
        // Apply edge-preserving blur for a bokeh-like feel
        const blurAmount = typeof s.blurIntensity === "number" ? s.blurIntensity : 8;
        const blurred = await sharp(inputBuffer)
          .blur(Math.max(0.3, blurAmount))
          .toBuffer();
        // Composite: we blend the original center with blurred edges via vignette mask
        const w = meta.width ?? 800;
        const h = meta.height ?? 600;
        const maskSvg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
          <defs><radialGradient id="m" cx="50%" cy="45%" r="40%">
            <stop offset="0%" stop-color="white" stop-opacity="1"/>
            <stop offset="80%" stop-color="white" stop-opacity="0.3"/>
            <stop offset="100%" stop-color="white" stop-opacity="0"/>
          </radialGradient></defs>
          <rect width="100%" height="100%" fill="url(#m)"/>
        </svg>`;
        const mask = await sharp(Buffer.from(maskSvg)).resize(w, h).png().toBuffer();
        // Use blurred as base, composite original through mask
        pipeline = sharp(blurred).composite([
          { input: inputBuffer, blend: "over" },
          { input: mask, blend: "dest-in" },
        ]);
        // Re-composite blurred background
        const intermediate = await pipeline.png().toBuffer();
        pipeline = sharp(blurred).composite([{ input: intermediate, blend: "over" }]);
        pipeline = pipeline.sharpen({ sigma: 0.4 });
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
        pipeline = pipeline.normalize().sharpen({ sigma: 1.0 }).modulate({ brightness: 1.01 });
        break;
      }
      default: {
        pipeline = pipeline.normalize().sharpen({ sigma: 1.0 });
        break;
      }
    }
  }

  // ── Granular settings overrides ──
  if (typeof s.exposure === "number" && s.exposure !== 0) {
    const expFactor = 1 + (s.exposure as number) / 100;
    pipeline = pipeline.modulate({ brightness: Math.max(0.3, Math.min(2.5, expFactor)) });
  }
  if (typeof s.brightness === "number" && s.brightness !== 0) {
    const bFactor = 1 + (s.brightness as number) / 100;
    pipeline = pipeline.modulate({ brightness: Math.max(0.3, Math.min(2.5, bFactor)) });
  }
  if (typeof s.contrast === "number" && s.contrast !== 0) {
    // Positive contrast = lower gamma (more contrast), negative = higher gamma
    const g = 1 - (s.contrast as number) / 200;
    pipeline = pipeline.gamma(Math.max(0.5, Math.min(3.0, g)));
  }
  if (typeof s.highlights === "number" && s.highlights !== 0) {
    // Approximate highlights via gamma on the bright end
    const hGamma = 1 - (s.highlights as number) / 300;
    pipeline = pipeline.gamma(Math.max(0.6, Math.min(2.0, hGamma)));
  }
  if (typeof s.shadows === "number" && s.shadows !== 0) {
    // Lift shadows by adjusting brightness and gamma
    const sFactor = 1 + (s.shadows as number) / 200;
    pipeline = pipeline.modulate({ brightness: Math.max(0.5, Math.min(1.8, sFactor)) });
  }
  if (typeof s.saturation === "number" && s.saturation !== 0) {
    const satFactor = 1 + (s.saturation as number) / 100;
    pipeline = pipeline.modulate({ saturation: Math.max(0, Math.min(3.0, satFactor)) });
  }
  if (typeof s.vibrance === "number" && s.vibrance !== 0) {
    // Vibrance: boost low-saturation areas more — approximate with mild saturation + normalize
    const vFactor = 1 + (s.vibrance as number) / 150;
    pipeline = pipeline.modulate({ saturation: Math.max(0.2, Math.min(2.0, vFactor)) });
    if ((s.vibrance as number) > 0) pipeline = pipeline.normalize();
  }
  if (typeof s.temperature === "number" && s.temperature !== 0) {
    const t = s.temperature as number;
    // Positive = warm (add red/yellow), negative = cool (add blue)
    const r = Math.round(128 + t * 0.6);
    const b = Math.round(128 - t * 0.6);
    pipeline = pipeline.tint({ r: Math.max(0, Math.min(255, r)), g: 128, b: Math.max(0, Math.min(255, b)) });
  }
  if (typeof s.tint === "number" && s.tint !== 0) {
    const tintVal = s.tint as number;
    // Positive = magenta, negative = green
    const g = Math.round(128 - tintVal * 0.5);
    pipeline = pipeline.tint({ r: 128, g: Math.max(0, Math.min(255, g)), b: 128 });
  }
  if (typeof s.hue === "number" && s.hue !== 0) {
    pipeline = pipeline.modulate({ hue: s.hue as number });
  }
  if (typeof s.sharpness === "number" && (s.sharpness as number) > 0) {
    pipeline = pipeline.sharpen({ sigma: (s.sharpness as number) / 40 });
  }
  if (typeof s.clarity === "number" && (s.clarity as number) > 0) {
    // Clarity = local contrast, approximate with unsharp mask (high sigma, low amount)
    pipeline = pipeline.sharpen({ sigma: 3.0, m1: (s.clarity as number) / 50, m2: 0.3 });
  }
  if (typeof s.blur === "number" && (s.blur as number) > 0) {
    pipeline = pipeline.blur(Math.max(0.3, (s.blur as number) / 10));
  }

  // Vignette and grain require compositing (must be done after other ops)
  if (typeof s.vignette === "number" && (s.vignette as number) > 0) {
    // Flatten pipeline first, then apply vignette
    const intermediateBuffer = await pipeline.png().toBuffer();
    const freshMeta = await sharp(intermediateBuffer).metadata();
    pipeline = await applyVignette(sharp(intermediateBuffer), freshMeta, s.vignette as number);
  }
  if (typeof s.grain === "number" && (s.grain as number) > 0) {
    const intermediateBuffer = await pipeline.png().toBuffer();
    const freshMeta = await sharp(intermediateBuffer).metadata();
    pipeline = await applyGrain(sharp(intermediateBuffer), freshMeta, s.grain as number);
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
