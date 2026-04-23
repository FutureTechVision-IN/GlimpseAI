import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { CANONICAL_FILTER_REGISTRY } from "@workspace/filter-registry";
import { enhanceImage, renderPreviewImage } from "../../artifacts/api-server/src/lib/image-enhancer";

interface CliOptions {
  fixturesDir: string | null;
  outputDir: string | null;
  limit: number | null;
  maxPreviewDimension: number;
}

interface Fixture {
  id: string;
  mimeType: string;
  buffer: Buffer;
}

interface ValidationMetrics {
  width: number;
  height: number;
  averagePixelDelta: number;
  diffPixelRatio: number;
  ahashDistance: number;
}

interface ValidationResult {
  filterId: string;
  fixtureId: string;
  passed: boolean;
  metrics: ValidationMetrics;
  thresholds: {
    averagePixelDeltaMax: number;
    diffPixelRatioMax: number;
    ahashDistanceMax: number;
  };
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    fixturesDir: path.resolve(process.cwd(), "scripts/fixtures/filter-validation"),
    outputDir: path.resolve(process.cwd(), "artifacts/filter-validation"),
    limit: null,
    maxPreviewDimension: 1600,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixtures") options.fixturesDir = argv[index + 1] ? path.resolve(argv[++index]) : null;
    else if (arg === "--output-dir") options.outputDir = argv[index + 1] ? path.resolve(argv[++index]) : null;
    else if (arg === "--limit") options.limit = argv[index + 1] ? Number(argv[++index]) : null;
    else if (arg === "--max-preview-dimension") options.maxPreviewDimension = argv[index + 1] ? Number(argv[++index]) : 1600;
    else if (arg === "--no-output") options.outputDir = null;
  }

  return options;
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function loadFixturesFromDirectory(fixturesDir: string): Promise<Fixture[]> {
  const entries = await readdir(fixturesDir, { withFileTypes: true });
  const supported = entries.filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name));
  const fixtures = await Promise.all(
    supported.map(async (entry) => {
      const filePath = path.join(fixturesDir, entry.name);
      const buffer = await readFile(filePath);
      const ext = path.extname(entry.name).toLowerCase();
      const mimeType =
        ext === ".png" ? "image/png"
          : ext === ".webp" ? "image/webp"
            : "image/jpeg";
      return {
        id: path.basename(entry.name, ext),
        mimeType,
        buffer,
      } satisfies Fixture;
    }),
  );

  return fixtures;
}

async function createSyntheticFixtures(): Promise<Fixture[]> {
  const portrait = await sharp({
    create: {
      width: 1400,
      height: 1800,
      channels: 4,
      background: { r: 236, g: 226, b: 220, alpha: 1 },
    },
  })
    .composite([
      {
        input: Buffer.from(`
          <svg width="1400" height="1800">
            <rect width="1400" height="1800" fill="url(#bg)" />
            <defs>
              <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#fbf7f1"/>
                <stop offset="100%" stop-color="#e4d8d4"/>
              </linearGradient>
            </defs>
            <ellipse cx="700" cy="950" rx="380" ry="560" fill="#ef7fa5" opacity="0.88"/>
            <circle cx="700" cy="620" r="180" fill="#efc7a8"/>
            <rect x="545" y="770" width="310" height="630" rx="120" fill="#f35d95" opacity="0.78"/>
          </svg>
        `),
      },
    ])
    .png()
    .toBuffer();

  const landscape = await sharp({
    create: {
      width: 1800,
      height: 1100,
      channels: 4,
      background: { r: 20, g: 30, b: 50, alpha: 1 },
    },
  })
    .composite([
      {
        input: Buffer.from(`
          <svg width="1800" height="1100">
            <defs>
              <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#7bc3ff"/>
                <stop offset="58%" stop-color="#f7d2a8"/>
                <stop offset="100%" stop-color="#385273"/>
              </linearGradient>
            </defs>
            <rect width="1800" height="1100" fill="url(#sky)"/>
            <path d="M0 820 L340 430 L670 790 L980 470 L1260 820 L1560 510 L1800 820 V1100 H0 Z" fill="#324d37"/>
            <path d="M0 900 L280 710 L610 940 L890 760 L1210 960 L1520 700 L1800 940 V1100 H0 Z" fill="#1f3326"/>
          </svg>
        `),
      },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();

  const highContrast = await sharp({
    create: {
      width: 1200,
      height: 1200,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([
      {
        input: Buffer.from(`
          <svg width="1200" height="1200">
            <rect width="1200" height="1200" fill="#ffffff"/>
            <rect x="0" y="0" width="600" height="600" fill="#111111"/>
            <rect x="600" y="600" width="600" height="600" fill="#111111"/>
            <circle cx="600" cy="600" r="220" fill="#ff5a5a"/>
          </svg>
        `),
      },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();

  const lowLight = await sharp({
    create: {
      width: 1600,
      height: 1000,
      channels: 4,
      background: { r: 10, g: 12, b: 18, alpha: 1 },
    },
  })
    .composite([
      {
        input: Buffer.from(`
          <svg width="1600" height="1000">
            <defs>
              <radialGradient id="glow" cx="70%" cy="35%" r="38%">
                <stop offset="0%" stop-color="#f3c36a" stop-opacity="0.85"/>
                <stop offset="100%" stop-color="#0b0d14" stop-opacity="0"/>
              </radialGradient>
            </defs>
            <rect width="1600" height="1000" fill="#10131c"/>
            <rect x="180" y="520" width="1240" height="260" rx="40" fill="#1c2735"/>
            <circle cx="1120" cy="360" r="260" fill="url(#glow)"/>
          </svg>
        `),
      },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();

  const transparent = await sharp({
    create: {
      width: 1200,
      height: 900,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: Buffer.from(`
          <svg width="1200" height="900">
            <rect width="1200" height="900" fill="transparent"/>
            <circle cx="380" cy="460" r="220" fill="#4fd1c5" fill-opacity="0.92"/>
            <rect x="520" y="210" width="360" height="470" rx="48" fill="#f6ad55" fill-opacity="0.88"/>
            <circle cx="860" cy="280" r="80" fill="#f56565" fill-opacity="0.9"/>
          </svg>
        `),
      },
    ])
    .png()
    .toBuffer();

  return [
    { id: "portrait-synthetic", mimeType: "image/png", buffer: portrait },
    { id: "landscape-synthetic", mimeType: "image/jpeg", buffer: landscape },
    { id: "contrast-synthetic", mimeType: "image/jpeg", buffer: highContrast },
    { id: "lowlight-synthetic", mimeType: "image/jpeg", buffer: lowLight },
    { id: "transparent-synthetic", mimeType: "image/png", buffer: transparent },
  ];
}

async function loadFixtures(options: CliOptions): Promise<Fixture[]> {
  if (options.fixturesDir && await fileExists(options.fixturesDir)) {
    const directoryFixtures = await loadFixturesFromDirectory(options.fixturesDir);
    if (directoryFixtures.length > 0) return directoryFixtures;
  }

  return createSyntheticFixtures();
}

async function toComparableImage(buffer: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(buffer)
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();
}

async function averageHash(buffer: Buffer): Promise<string> {
  const data = await sharp(buffer)
    .resize(8, 8, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer();

  const average = data.reduce((sum, value) => sum + value, 0) / data.length;
  return Array.from(data, (value) => (value >= average ? "1" : "0")).join("");
}

function hammingDistance(left: string, right: string): number {
  let distance = 0;
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    if (left[index] !== right[index]) distance += 1;
  }
  return distance;
}

async function compareImages(previewBuffer: Buffer, exportBuffer: Buffer): Promise<ValidationMetrics> {
  const previewMeta = await sharp(previewBuffer).metadata();
  const width = previewMeta.width ?? 1;
  const height = previewMeta.height ?? 1;

  const previewRaw = await toComparableImage(previewBuffer, width, height);
  const exportRaw = await toComparableImage(exportBuffer, width, height);

  let totalDelta = 0;
  let changedPixels = 0;

  for (let index = 0; index < previewRaw.length; index += 4) {
    const rDelta = Math.abs(previewRaw[index] - exportRaw[index]);
    const gDelta = Math.abs(previewRaw[index + 1] - exportRaw[index + 1]);
    const bDelta = Math.abs(previewRaw[index + 2] - exportRaw[index + 2]);
    const pixelDelta = (rDelta + gDelta + bDelta) / 3;
    totalDelta += pixelDelta;
    if (pixelDelta > 8) changedPixels += 1;
  }

  const previewHash = await averageHash(previewBuffer);
  const exportHash = await averageHash(exportBuffer);

  return {
    width,
    height,
    averagePixelDelta: Number((totalDelta / (width * height)).toFixed(3)),
    diffPixelRatio: Number((changedPixels / (width * height)).toFixed(4)),
    ahashDistance: hammingDistance(previewHash, exportHash),
  };
}

async function writeArtifacts(
  outputDir: string,
  filterId: string,
  fixtureId: string,
  previewBuffer: Buffer,
  exportBuffer: Buffer,
  metrics: ValidationMetrics,
): Promise<void> {
  const targetDir = path.join(outputDir, filterId, fixtureId);
  await mkdir(targetDir, { recursive: true });

  const previewMeta = await sharp(previewBuffer).metadata();
  const width = previewMeta.width ?? 1;
  const height = previewMeta.height ?? 1;
  const previewRaw = await toComparableImage(previewBuffer, width, height);
  const exportRaw = await toComparableImage(exportBuffer, width, height);
  const diffRaw = Buffer.alloc(width * height * 4);

  for (let index = 0; index < previewRaw.length; index += 4) {
    const delta = Math.min(255, Math.round(
      ((Math.abs(previewRaw[index] - exportRaw[index]) +
        Math.abs(previewRaw[index + 1] - exportRaw[index + 1]) +
        Math.abs(previewRaw[index + 2] - exportRaw[index + 2])) / 3) * 4,
    ));
    diffRaw[index] = delta;
    diffRaw[index + 1] = 32;
    diffRaw[index + 2] = 255 - delta;
    diffRaw[index + 3] = 255;
  }

  await Promise.all([
    sharp(previewBuffer).png().toFile(path.join(targetDir, "preview.png")),
    sharp(exportBuffer).png().toFile(path.join(targetDir, "export.png")),
    sharp(diffRaw, { raw: { width, height, channels: 4 } }).png().toFile(path.join(targetDir, "diff.png")),
    writeFile(path.join(targetDir, "metrics.json"), JSON.stringify(metrics, null, 2)),
  ]);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const fixtures = await loadFixtures(options);
  const filters = options.limit ? CANONICAL_FILTER_REGISTRY.slice(0, options.limit) : CANONICAL_FILTER_REGISTRY;
  const results: ValidationResult[] = [];

  if (options.outputDir) {
    await mkdir(options.outputDir, { recursive: true });
  }

  for (const fixture of fixtures) {
    const base64Data = fixture.buffer.toString("base64");
    for (const filter of filters) {
      const settings = filter.id === "original"
        ? { filterId: filter.id, filterVersion: filter.version }
        : { filterId: filter.id, filterVersion: filter.version };

      const preview = await renderPreviewImage(
        base64Data,
        fixture.mimeType,
        { enhancementType: "filter", settings },
        options.maxPreviewDimension,
      );
      const exported = await enhanceImage(
        base64Data,
        fixture.mimeType,
        { enhancementType: "filter", settings },
      );

      const previewBuffer = Buffer.from(preview.base64, "base64");
      const exportBuffer = Buffer.from(exported.base64, "base64");
      const metrics = await compareImages(previewBuffer, exportBuffer);
      const passed =
        metrics.averagePixelDelta <= filter.validation.averagePixelDeltaMax &&
        metrics.diffPixelRatio <= filter.validation.diffPixelRatioMax &&
        metrics.ahashDistance <= filter.validation.ahashDistanceMax;

      const result: ValidationResult = {
        filterId: filter.id,
        fixtureId: fixture.id,
        passed,
        metrics,
        thresholds: filter.validation,
      };
      results.push(result);

      const prefix = passed ? "PASS" : "FAIL";
      console.log(
        `${prefix} ${filter.id.padEnd(14)} ${fixture.id.padEnd(22)} ` +
        `delta=${metrics.averagePixelDelta} diff=${metrics.diffPixelRatio} ahash=${metrics.ahashDistance}`,
      );

      if (!passed && options.outputDir) {
        await writeArtifacts(options.outputDir, filter.id, fixture.id, previewBuffer, exportBuffer, metrics);
      }
    }
  }

  const failures = results.filter((result) => !result.passed);
  const summary = {
    timestamp: new Date().toISOString(),
    fixtureCount: fixtures.length,
    filterCount: filters.length,
    totalRuns: results.length,
    failures: failures.length,
    results,
  };

  if (options.outputDir) {
    await writeFile(path.join(options.outputDir, "summary.json"), JSON.stringify(summary, null, 2));
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} preview/export validation runs exceeded thresholds.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nAll ${results.length} preview/export validation runs passed.`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
