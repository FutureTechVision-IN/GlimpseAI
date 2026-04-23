export type FilterTier = "standard" | "premium";
export type FilterCategory =
  | "neutral"
  | "portrait"
  | "cinematic"
  | "creative"
  | "monochrome"
  | "seasonal";

export interface FilterState {
  brightness: number;
  contrast: number;
  saturation: number;
  sharpness: number;
  warmth: number;
  highlights: number;
  shadows: number;
  hue: number;
}

export interface TransformState {
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

export interface CropBox {
  x: number;
  y: number;
  x2: number;
  y2: number;
}

export type FilterOperation =
  | { type: "modulate"; brightness?: number; saturation?: number; hue?: number }
  | { type: "normalize" }
  | { type: "sharpen"; sigma: number; m1?: number; m2?: number }
  | { type: "gamma"; value: number }
  | { type: "safeGamma"; value: number }
  | { type: "grayscale" }
  | { type: "tint"; r: number; g: number; b: number }
  | { type: "linear"; a: number; b: number }
  | { type: "recomb"; matrix: [[number, number, number], [number, number, number], [number, number, number]] };

export interface FilterValidationThresholds {
  averagePixelDeltaMax: number;
  diffPixelRatioMax: number;
  ahashDistanceMax: number;
}

export interface FilterRendererCapabilities {
  preview: "canonical-server";
  export: "sharp";
  requiresSidecar: boolean;
  deterministic: boolean;
}

export interface CanonicalFilterDefinition {
  id: string;
  version: string;
  name: string;
  category: FilterCategory;
  tier: FilterTier;
  gradient: string;
  styleTags: string[];
  previewState: FilterState;
  previewCssExtra?: string;
  operations: FilterOperation[];
  renderer: FilterRendererCapabilities;
  validation: FilterValidationThresholds;
}

export const DEFAULT_FILTER_STATE: FilterState = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  sharpness: 100,
  warmth: 0,
  highlights: 0,
  shadows: 0,
  hue: 0,
};

export const DEFAULT_TRANSFORM_STATE: TransformState = {
  rotation: 0,
  flipH: false,
  flipV: false,
};

export const DEFAULT_CROP_BOX: CropBox = {
  x: 0,
  y: 0,
  x2: 100,
  y2: 100,
};

const STANDARD_VALIDATION: FilterValidationThresholds = {
  averagePixelDeltaMax: 6,
  diffPixelRatioMax: 0.08,
  ahashDistanceMax: 8,
};

const CREATIVE_VALIDATION: FilterValidationThresholds = {
  averagePixelDeltaMax: 8,
  diffPixelRatioMax: 0.12,
  ahashDistanceMax: 10,
};

const PREMIUM_VALIDATION: FilterValidationThresholds = {
  averagePixelDeltaMax: 9,
  diffPixelRatioMax: 0.14,
  ahashDistanceMax: 12,
};

const SHARP_RENDERER: FilterRendererCapabilities = {
  preview: "canonical-server",
  export: "sharp",
  requiresSidecar: false,
  deterministic: true,
};

function defineFilter(definition: CanonicalFilterDefinition): CanonicalFilterDefinition {
  return definition;
}

export const CANONICAL_FILTER_REGISTRY: CanonicalFilterDefinition[] = [
  defineFilter({
    id: "original",
    version: "1.0.0",
    name: "Original",
    category: "neutral",
    tier: "standard",
    gradient: "from-zinc-700 to-zinc-800",
    styleTags: ["neutral", "reference"],
    previewState: DEFAULT_FILTER_STATE,
    operations: [],
    renderer: SHARP_RENDERER,
    validation: STANDARD_VALIDATION,
  }),
  defineFilter({
    id: "vivid",
    version: "1.0.0",
    name: "Vivid",
    category: "creative",
    tier: "standard",
    gradient: "from-red-500 to-amber-500",
    styleTags: ["vibrant", "punchy"],
    previewState: { ...DEFAULT_FILTER_STATE, brightness: 103, contrast: 120, saturation: 135, sharpness: 110 },
    operations: [
      { type: "modulate", saturation: 1.35, brightness: 1.03 },
      { type: "normalize" },
      { type: "sharpen", sigma: 0.6 },
    ],
    renderer: SHARP_RENDERER,
    validation: CREATIVE_VALIDATION,
  }),
  defineFilter({
    id: "portrait",
    version: "1.0.0",
    name: "Portrait",
    category: "portrait",
    tier: "standard",
    gradient: "from-rose-400 to-pink-500",
    styleTags: ["portrait", "soft"],
    previewState: { ...DEFAULT_FILTER_STATE, brightness: 104, contrast: 95, saturation: 92, sharpness: 105 },
    previewCssExtra: "sepia(5%)",
    operations: [
      { type: "modulate", brightness: 1.04, saturation: 0.92 },
      { type: "sharpen", sigma: 0.7, m1: 0.6, m2: 0.3 },
      { type: "gamma", value: 1.06 },
    ],
    renderer: SHARP_RENDERER,
    validation: STANDARD_VALIDATION,
  }),
  defineFilter({
    id: "bw",
    version: "1.0.0",
    name: "B&W",
    category: "monochrome",
    tier: "standard",
    gradient: "from-zinc-300 to-zinc-600",
    styleTags: ["black-and-white", "contrast"],
    previewState: { ...DEFAULT_FILTER_STATE, contrast: 115, saturation: 0 },
    operations: [
      { type: "grayscale" },
      { type: "normalize" },
      { type: "sharpen", sigma: 1.0 },
      { type: "gamma", value: 1.1 },
    ],
    renderer: SHARP_RENDERER,
    validation: STANDARD_VALIDATION,
  }),
  defineFilter({
    id: "film",
    version: "1.0.0",
    name: "Film",
    category: "cinematic",
    tier: "standard",
    gradient: "from-amber-600 to-yellow-800",
    styleTags: ["film", "warm", "grainless"],
    previewState: { ...DEFAULT_FILTER_STATE, brightness: 97, contrast: 92, saturation: 80, sharpness: 95 },
    previewCssExtra: "sepia(22%) hue-rotate(-5deg)",
    operations: [
      { type: "modulate", saturation: 0.8, brightness: 0.97 },
      { type: "gamma", value: 1.12 },
      { type: "tint", r: 230, g: 215, b: 200 },
      { type: "sharpen", sigma: 0.5 },
    ],
    renderer: SHARP_RENDERER,
    validation: CREATIVE_VALIDATION,
  }),
  defineFilter({
    id: "hdr",
    version: "1.0.0",
    name: "HDR",
    category: "creative",
    tier: "standard",
    gradient: "from-cyan-500 to-blue-600",
    styleTags: ["hdr", "clarity"],
    previewState: { ...DEFAULT_FILTER_STATE, contrast: 140, saturation: 120, sharpness: 118 },
    operations: [
      { type: "normalize" },
      { type: "sharpen", sigma: 1.8, m1: 2.0, m2: 1.0 },
      { type: "modulate", saturation: 1.2, brightness: 1.02 },
    ],
    renderer: SHARP_RENDERER,
    validation: CREATIVE_VALIDATION,
  }),
  defineFilter({
    id: "vintage",
    version: "1.0.0",
    name: "Vintage",
    category: "cinematic",
    tier: "standard",
    gradient: "from-amber-400 to-orange-700",
    styleTags: ["vintage", "sepia"],
    previewState: { ...DEFAULT_FILTER_STATE, brightness: 95, contrast: 92, saturation: 70, sharpness: 92 },
    previewCssExtra: "sepia(30%) hue-rotate(-8deg)",
    operations: [
      { type: "modulate", saturation: 0.7, brightness: 0.95 },
      { type: "tint", r: 210, g: 195, b: 170 },
      { type: "gamma", value: 1.15 },
      { type: "sharpen", sigma: 0.4 },
    ],
    renderer: SHARP_RENDERER,
    validation: CREATIVE_VALIDATION,
  }),
  defineFilter({
    id: "cinematic",
    version: "1.0.0",
    name: "Cinematic",
    category: "cinematic",
    tier: "standard",
    gradient: "from-teal-600 to-cyan-800",
    styleTags: ["cinematic", "moody"],
    previewState: { ...DEFAULT_FILTER_STATE, brightness: 96, contrast: 108, saturation: 85 },
    previewCssExtra: "sepia(8%) hue-rotate(185deg)",
    operations: [
      { type: "modulate", saturation: 0.85, brightness: 0.96 },
      { type: "tint", r: 180, g: 195, b: 215 },
      { type: "gamma", value: 1.08 },
      { type: "sharpen", sigma: 0.7 },
    ],
    renderer: SHARP_RENDERER,
    validation: CREATIVE_VALIDATION,
  }),
  defineFilter({
    id: "vibrant",
    version: "1.0.0",
    name: "Vibrant",
    category: "creative",
    tier: "standard",
    gradient: "from-fuchsia-500 to-pink-600",
    styleTags: ["vibrant", "social"],
    previewState: { ...DEFAULT_FILTER_STATE, brightness: 105, contrast: 110, saturation: 145, sharpness: 108 },
    operations: [
      { type: "modulate", saturation: 1.45, brightness: 1.05 },
      { type: "normalize" },
      { type: "sharpen", sigma: 0.8 },
    ],
    renderer: SHARP_RENDERER,
    validation: CREATIVE_VALIDATION,
  }),
  defineFilter({
    id: "filmnoir",
    version: "1.0.0",
    name: "Film Noir",
    category: "monochrome",
    tier: "standard",
    gradient: "from-zinc-900 to-zinc-700",
    styleTags: ["film-noir", "black-and-white"],
    previewState: { ...DEFAULT_FILTER_STATE, brightness: 90, contrast: 130, saturation: 0, sharpness: 112 },
    operations: [
      { type: "grayscale" },
      { type: "normalize" },
      { type: "gamma", value: 1.3 },
      { type: "sharpen", sigma: 1.2, m1: 1.5, m2: 0.8 },
    ],
    renderer: SHARP_RENDERER,
    validation: STANDARD_VALIDATION,
  }),
  defineFilter({
    id: "goldenhour",
    version: "1.0.0",
    name: "Golden Hour",
    category: "seasonal",
    tier: "standard",
    gradient: "from-yellow-400 to-orange-500",
    styleTags: ["golden", "warm"],
    previewState: { ...DEFAULT_FILTER_STATE, brightness: 106, saturation: 110 },
    previewCssExtra: "sepia(18%) hue-rotate(-10deg)",
    operations: [
      { type: "modulate", saturation: 1.1, brightness: 1.06 },
      { type: "tint", r: 255, g: 220, b: 180 },
      { type: "gamma", value: 1.05 },
      { type: "sharpen", sigma: 0.5 },
    ],
    renderer: SHARP_RENDERER,
    validation: CREATIVE_VALIDATION,
  }),
  defineFilter({
    id: "moody",
    version: "1.0.0",
    name: "Moody",
    category: "cinematic",
    tier: "standard",
    gradient: "from-indigo-800 to-purple-900",
    styleTags: ["moody", "blue"],
    previewState: { ...DEFAULT_FILTER_STATE, brightness: 92, contrast: 105, saturation: 75 },
    previewCssExtra: "sepia(10%) hue-rotate(220deg)",
    operations: [
      { type: "modulate", saturation: 0.75, brightness: 0.92 },
      { type: "tint", r: 160, g: 170, b: 200 },
      { type: "gamma", value: 1.12 },
      { type: "sharpen", sigma: 0.6 },
    ],
    renderer: SHARP_RENDERER,
    validation: CREATIVE_VALIDATION,
  }),
  defineFilter({
    id: "fresh",
    version: "1.0.0",
    name: "Fresh",
    category: "creative",
    tier: "standard",
    gradient: "from-green-400 to-emerald-500",
    styleTags: ["fresh", "clean"],
    previewState: { ...DEFAULT_FILTER_STATE, brightness: 108, saturation: 115 },
    operations: [
      { type: "modulate", saturation: 1.15, brightness: 1.08 },
      { type: "safeGamma", value: 0.95 },
      { type: "normalize" },
      { type: "sharpen", sigma: 0.5 },
    ],
    renderer: SHARP_RENDERER,
    validation: CREATIVE_VALIDATION,
  }),
  defineFilter({
    id: "retro",
    version: "1.0.0",
    name: "Retro",
    category: "cinematic",
    tier: "standard",
    gradient: "from-orange-600 to-red-800",
    styleTags: ["retro", "analog"],
    previewState: { ...DEFAULT_FILTER_STATE, brightness: 98, contrast: 95, saturation: 65, sharpness: 92 },
    previewCssExtra: "sepia(28%) hue-rotate(-12deg)",
    operations: [
      { type: "modulate", saturation: 0.65, brightness: 0.98 },
      { type: "tint", r: 200, g: 180, b: 150 },
      { type: "gamma", value: 1.18 },
      { type: "sharpen", sigma: 0.4 },
    ],
    renderer: SHARP_RENDERER,
    validation: CREATIVE_VALIDATION,
  }),
  defineFilter({
    id: "dramatic",
    version: "1.0.0",
    name: "Dramatic",
    category: "creative",
    tier: "standard",
    gradient: "from-red-700 to-zinc-900",
    styleTags: ["dramatic", "high-contrast"],
    previewState: { ...DEFAULT_FILTER_STATE, brightness: 95, contrast: 140, saturation: 110, sharpness: 120 },
    operations: [
      { type: "normalize" },
      { type: "sharpen", sigma: 2.0, m1: 2.5, m2: 1.2 },
      { type: "modulate", saturation: 1.1, brightness: 0.95 },
      { type: "gamma", value: 1.15 },
    ],
    renderer: SHARP_RENDERER,
    validation: CREATIVE_VALIDATION,
  }),
  defineFilter({
    id: "warm_tone",
    version: "1.0.0",
    name: "Warm Tone",
    category: "seasonal",
    tier: "standard",
    gradient: "from-orange-400 to-red-500",
    styleTags: ["warm", "golden"],
    previewState: { ...DEFAULT_FILTER_STATE, brightness: 104, saturation: 110, warmth: 20 },
    previewCssExtra: "sepia(15%)",
    operations: [
      { type: "modulate", saturation: 1.1, brightness: 1.04 },
      { type: "tint", r: 245, g: 220, b: 185 },
      { type: "gamma", value: 1.04 },
      { type: "sharpen", sigma: 0.5 },
    ],
    renderer: SHARP_RENDERER,
    validation: CREATIVE_VALIDATION,
  }),
  defineFilter({
    id: "cool_tone",
    version: "1.0.0",
    name: "Cool Tone",
    category: "seasonal",
    tier: "standard",
    gradient: "from-sky-400 to-blue-600",
    styleTags: ["cool", "crisp"],
    previewState: { ...DEFAULT_FILTER_STATE, brightness: 102, saturation: 95, warmth: -20 },
    previewCssExtra: "hue-rotate(195deg) sepia(8%)",
    operations: [
      { type: "modulate", saturation: 0.95, brightness: 1.02 },
      { type: "tint", r: 170, g: 200, b: 230 },
      { type: "gamma", value: 1.06 },
      { type: "sharpen", sigma: 0.5 },
    ],
    renderer: SHARP_RENDERER,
    validation: CREATIVE_VALIDATION,
  }),
  defineFilter({
    id: "sunset",
    version: "1.0.0",
    name: "Sunset",
    category: "seasonal",
    tier: "standard",
    gradient: "from-orange-500 to-pink-600",
    styleTags: ["sunset", "warm"],
    previewState: { ...DEFAULT_FILTER_STATE, brightness: 103, saturation: 120, warmth: 25 },
    previewCssExtra: "sepia(20%) hue-rotate(-15deg)",
    operations: [
      { type: "modulate", saturation: 1.2, brightness: 1.03 },
      { type: "tint", r: 255, g: 200, b: 160 },
      { type: "gamma", value: 1.05 },
      { type: "sharpen", sigma: 0.4 },
    ],
    renderer: SHARP_RENDERER,
    validation: CREATIVE_VALIDATION,
  }),
  defineFilter({
    id: "matte",
    version: "1.0.0",
    name: "Matte",
    category: "cinematic",
    tier: "standard",
    gradient: "from-stone-400 to-stone-600",
    styleTags: ["matte", "flat"],
    previewState: { ...DEFAULT_FILTER_STATE, brightness: 102, contrast: 85, saturation: 70 },
    operations: [
      { type: "modulate", saturation: 0.7, brightness: 1.02 },
      { type: "safeGamma", value: 0.92 },
      { type: "linear", a: 0.9, b: 15 },
      { type: "sharpen", sigma: 0.3 },
    ],
    renderer: SHARP_RENDERER,
    validation: CREATIVE_VALIDATION,
  }),
  defineFilter({
    id: "neon",
    version: "1.0.0",
    name: "Neon",
    category: "creative",
    tier: "standard",
    gradient: "from-violet-500 to-fuchsia-600",
    styleTags: ["neon", "high-energy"],
    previewState: { ...DEFAULT_FILTER_STATE, contrast: 130, saturation: 160, sharpness: 115 },
    operations: [
      { type: "modulate", saturation: 1.6, brightness: 1.05 },
      { type: "sharpen", sigma: 1.0 },
      { type: "normalize" },
    ],
    renderer: SHARP_RENDERER,
    validation: CREATIVE_VALIDATION,
  }),
  defineFilter({
    id: "airy",
    version: "1.0.0",
    name: "Airy",
    category: "portrait",
    tier: "premium",
    gradient: "from-sky-200 to-blue-300",
    styleTags: ["airy", "soft"],
    previewState: { ...DEFAULT_FILTER_STATE, brightness: 112, contrast: 90, saturation: 85 },
    previewCssExtra: "sepia(5%) hue-rotate(200deg)",
    operations: [
      { type: "modulate", brightness: 1.12, saturation: 0.85 },
      { type: "safeGamma", value: 0.88 },
      { type: "sharpen", sigma: 0.3 },
      { type: "tint", r: 240, g: 240, b: 250 },
    ],
    renderer: SHARP_RENDERER,
    validation: PREMIUM_VALIDATION,
  }),
  defineFilter({
    id: "teal_orange",
    version: "1.0.0",
    name: "Teal & Orange",
    category: "cinematic",
    tier: "premium",
    gradient: "from-teal-500 to-orange-500",
    styleTags: ["teal-orange", "cinematic"],
    previewState: { ...DEFAULT_FILTER_STATE, contrast: 115, saturation: 120 },
    previewCssExtra: "sepia(15%) hue-rotate(-5deg)",
    operations: [
      { type: "modulate", saturation: 1.2, brightness: 1.02 },
      { type: "tint", r: 220, g: 195, b: 170 },
      { type: "normalize" },
      { type: "sharpen", sigma: 0.6 },
    ],
    renderer: SHARP_RENDERER,
    validation: PREMIUM_VALIDATION,
  }),
  defineFilter({
    id: "pastel",
    version: "1.0.0",
    name: "Pastel",
    category: "creative",
    tier: "premium",
    gradient: "from-pink-300 to-violet-300",
    styleTags: ["pastel", "soft"],
    previewState: { ...DEFAULT_FILTER_STATE, brightness: 115, contrast: 85, saturation: 55 },
    previewCssExtra: "sepia(8%) hue-rotate(320deg)",
    operations: [
      { type: "modulate", saturation: 0.55, brightness: 1.15 },
      { type: "safeGamma", value: 0.85 },
      { type: "sharpen", sigma: 0.3 },
      { type: "tint", r: 240, g: 230, b: 235 },
    ],
    renderer: SHARP_RENDERER,
    validation: PREMIUM_VALIDATION,
  }),
  defineFilter({
    id: "noir_color",
    version: "1.0.0",
    name: "Noir Color",
    category: "monochrome",
    tier: "premium",
    gradient: "from-zinc-800 to-amber-900",
    styleTags: ["noir", "desaturated"],
    previewState: { ...DEFAULT_FILTER_STATE, brightness: 88, contrast: 125, saturation: 40 },
    operations: [
      { type: "modulate", saturation: 0.4, brightness: 0.88 },
      { type: "gamma", value: 1.25 },
      { type: "sharpen", sigma: 1.5, m1: 2.0, m2: 1.0 },
      { type: "normalize" },
    ],
    renderer: SHARP_RENDERER,
    validation: PREMIUM_VALIDATION,
  }),
  defineFilter({
    id: "cross_process",
    version: "1.0.0",
    name: "Cross Process",
    category: "creative",
    tier: "premium",
    gradient: "from-green-500 to-purple-600",
    styleTags: ["cross-process", "experimental"],
    previewState: { ...DEFAULT_FILTER_STATE, contrast: 120, saturation: 130 },
    previewCssExtra: "hue-rotate(30deg) sepia(8%)",
    operations: [
      { type: "modulate", saturation: 1.3, brightness: 1.0 },
      { type: "tint", r: 200, g: 240, b: 180 },
      { type: "gamma", value: 1.1 },
      { type: "sharpen", sigma: 0.6 },
    ],
    renderer: SHARP_RENDERER,
    validation: PREMIUM_VALIDATION,
  }),
  defineFilter({
    id: "cyberpunk",
    version: "1.0.0",
    name: "Cyberpunk",
    category: "creative",
    tier: "premium",
    gradient: "from-cyan-400 to-fuchsia-600",
    styleTags: ["cyberpunk", "neon"],
    previewState: { ...DEFAULT_FILTER_STATE, contrast: 130, saturation: 150 },
    previewCssExtra: "hue-rotate(280deg) sepia(10%)",
    operations: [
      { type: "modulate", saturation: 1.5, brightness: 0.95 },
      { type: "tint", r: 200, g: 150, b: 255 },
      { type: "gamma", value: 1.15 },
      { type: "sharpen", sigma: 0.8 },
    ],
    renderer: SHARP_RENDERER,
    validation: PREMIUM_VALIDATION,
  }),
  defineFilter({
    id: "arctic",
    version: "1.0.0",
    name: "Arctic",
    category: "seasonal",
    tier: "premium",
    gradient: "from-cyan-200 to-blue-400",
    styleTags: ["arctic", "cool"],
    previewState: { ...DEFAULT_FILTER_STATE, brightness: 110, contrast: 95, saturation: 60, warmth: -30 },
    previewCssExtra: "hue-rotate(195deg) sepia(5%)",
    operations: [
      { type: "modulate", saturation: 0.6, brightness: 1.1 },
      { type: "tint", r: 190, g: 215, b: 240 },
      { type: "gamma", value: 1.02 },
      { type: "sharpen", sigma: 0.4 },
    ],
    renderer: SHARP_RENDERER,
    validation: PREMIUM_VALIDATION,
  }),
  defineFilter({
    id: "ember",
    version: "1.0.0",
    name: "Ember",
    category: "seasonal",
    tier: "premium",
    gradient: "from-orange-600 to-red-700",
    styleTags: ["ember", "warm"],
    previewState: { ...DEFAULT_FILTER_STATE, brightness: 95, contrast: 115, saturation: 115, warmth: 30 },
    previewCssExtra: "sepia(18%)",
    operations: [
      { type: "modulate", saturation: 1.15, brightness: 0.95 },
      { type: "tint", r: 255, g: 180, b: 140 },
      { type: "gamma", value: 1.1 },
      { type: "sharpen", sigma: 0.7 },
    ],
    renderer: SHARP_RENDERER,
    validation: PREMIUM_VALIDATION,
  }),
  defineFilter({
    id: "chrome",
    version: "1.0.0",
    name: "Chrome",
    category: "monochrome",
    tier: "premium",
    gradient: "from-zinc-300 to-zinc-500",
    styleTags: ["chrome", "metallic"],
    previewState: { ...DEFAULT_FILTER_STATE, brightness: 108, contrast: 120, saturation: 30, sharpness: 115 },
    operations: [
      { type: "modulate", saturation: 0.3, brightness: 1.08 },
      { type: "normalize" },
      { type: "sharpen", sigma: 1.5, m1: 1.8, m2: 0.9 },
      { type: "gamma", value: 1.0 },
    ],
    renderer: SHARP_RENDERER,
    validation: PREMIUM_VALIDATION,
  }),
];

export const CANONICAL_FILTERS_BY_ID = new Map(
  CANONICAL_FILTER_REGISTRY.map((filter) => [filter.id, filter] as const),
);

export const PREMIUM_FILTER_IDS = new Set(
  CANONICAL_FILTER_REGISTRY
    .filter((filter) => filter.tier === "premium")
    .map((filter) => filter.id),
);

export function getCanonicalFilterDefinition(filterId: string | null | undefined): CanonicalFilterDefinition | null {
  if (!filterId) return null;
  return CANONICAL_FILTERS_BY_ID.get(filterId) ?? null;
}

export function isPremiumFilter(filterId: string | null | undefined): boolean {
  return !!filterId && PREMIUM_FILTER_IDS.has(filterId);
}
