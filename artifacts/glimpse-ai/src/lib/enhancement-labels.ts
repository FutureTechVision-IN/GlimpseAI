/**
 * enhancement-labels.ts — Human-readable labels, colors, and icons for enhancement types.
 * Used on dashboard, history, and analytics views.
 */

export interface EnhancementMeta {
  label: string;
  shortLabel: string;
  color: string;       // Tailwind text color class
  bgColor: string;     // Tailwind bg color class
  borderColor: string; // Tailwind border color class
  category: "basic" | "restoration" | "video" | "filter";
}

const ENHANCEMENT_META: Record<string, EnhancementMeta> = {
  // Basic enhancements
  auto: { label: "Auto Enhance", shortLabel: "Auto", color: "text-teal-400", bgColor: "bg-teal-500/10", borderColor: "border-teal-500/30", category: "basic" },
  portrait: { label: "Portrait", shortLabel: "Portrait", color: "text-pink-400", bgColor: "bg-pink-500/10", borderColor: "border-pink-500/30", category: "basic" },
  skin: { label: "Skin Smooth", shortLabel: "Skin", color: "text-rose-400", bgColor: "bg-rose-500/10", borderColor: "border-rose-500/30", category: "basic" },
  lighting: { label: "Lighting", shortLabel: "Light", color: "text-amber-400", bgColor: "bg-amber-500/10", borderColor: "border-amber-500/30", category: "basic" },
  lighting_enhance: { label: "Lighting Enhance", shortLabel: "Light+", color: "text-amber-300", bgColor: "bg-amber-500/10", borderColor: "border-amber-500/30", category: "basic" },
  color: { label: "Color Correct", shortLabel: "Color", color: "text-orange-400", bgColor: "bg-orange-500/10", borderColor: "border-orange-500/30", category: "basic" },
  background: { label: "Background", shortLabel: "BG", color: "text-sky-400", bgColor: "bg-sky-500/10", borderColor: "border-sky-500/30", category: "basic" },
  beauty: { label: "Beauty", shortLabel: "Beauty", color: "text-fuchsia-400", bgColor: "bg-fuchsia-500/10", borderColor: "border-fuchsia-500/30", category: "basic" },
  upscale: { label: "Upscale 2×", shortLabel: "2×", color: "text-indigo-400", bgColor: "bg-indigo-500/10", borderColor: "border-indigo-500/30", category: "basic" },
  upscale_4x: { label: "Upscale 4×", shortLabel: "4×", color: "text-indigo-300", bgColor: "bg-indigo-500/10", borderColor: "border-indigo-500/30", category: "basic" },
  blur_background: { label: "Blur BG", shortLabel: "Blur", color: "text-sky-300", bgColor: "bg-sky-500/10", borderColor: "border-sky-500/30", category: "basic" },
  posture: { label: "Posture", shortLabel: "Posture", color: "text-lime-400", bgColor: "bg-lime-500/10", borderColor: "border-lime-500/30", category: "basic" },
  skin_retouch: { label: "Skin Retouch", shortLabel: "Retouch", color: "text-rose-300", bgColor: "bg-rose-500/10", borderColor: "border-rose-500/30", category: "basic" },

  // Filters
  filter: { label: "Filter", shortLabel: "Filter", color: "text-violet-400", bgColor: "bg-violet-500/10", borderColor: "border-violet-500/30", category: "filter" },
  color_grade_cinematic: { label: "Cinematic", shortLabel: "Cine", color: "text-violet-300", bgColor: "bg-violet-500/10", borderColor: "border-violet-500/30", category: "filter" },
  color_grade_warm: { label: "Warm Grade", shortLabel: "Warm", color: "text-orange-300", bgColor: "bg-orange-500/10", borderColor: "border-orange-500/30", category: "filter" },
  color_grade_cool: { label: "Cool Grade", shortLabel: "Cool", color: "text-cyan-300", bgColor: "bg-cyan-500/10", borderColor: "border-cyan-500/30", category: "filter" },

  // AI Restoration (Premium)
  face_restore: { label: "Face Restore", shortLabel: "Face AI", color: "text-emerald-400", bgColor: "bg-emerald-500/10", borderColor: "border-emerald-500/30", category: "restoration" },
  face_restore_hd: { label: "Face Restore HD", shortLabel: "Face HD", color: "text-emerald-300", bgColor: "bg-emerald-500/10", borderColor: "border-emerald-500/30", category: "restoration" },
  codeformer: { label: "CodeFormer", shortLabel: "CF", color: "text-emerald-200", bgColor: "bg-emerald-500/10", borderColor: "border-emerald-500/30", category: "restoration" },
  hybrid: { label: "Hybrid Restore", shortLabel: "Hybrid", color: "text-emerald-100", bgColor: "bg-emerald-500/10", borderColor: "border-emerald-500/30", category: "restoration" },
  auto_face: { label: "Auto Face AI", shortLabel: "Auto Face", color: "text-green-400", bgColor: "bg-green-500/10", borderColor: "border-green-500/30", category: "restoration" },
  esrgan_upscale_2x: { label: "ESRGAN 2×", shortLabel: "SR 2×", color: "text-cyan-400", bgColor: "bg-cyan-500/10", borderColor: "border-cyan-500/30", category: "restoration" },
  esrgan_upscale_4x: { label: "ESRGAN 4×", shortLabel: "SR 4×", color: "text-cyan-300", bgColor: "bg-cyan-500/10", borderColor: "border-cyan-500/30", category: "restoration" },
  old_photo_restore: { label: "Old Photo Fix", shortLabel: "Restore", color: "text-amber-300", bgColor: "bg-amber-500/10", borderColor: "border-amber-500/30", category: "restoration" },

  // Video
  video_restore: { label: "Video Restore", shortLabel: "Vid AI", color: "text-purple-400", bgColor: "bg-purple-500/10", borderColor: "border-purple-500/30", category: "video" },
  trim: { label: "Trim", shortLabel: "Trim", color: "text-purple-300", bgColor: "bg-purple-500/10", borderColor: "border-purple-500/30", category: "video" },
  stabilize: { label: "Stabilize", shortLabel: "Stab", color: "text-purple-200", bgColor: "bg-purple-500/10", borderColor: "border-purple-500/30", category: "video" },
  custom: { label: "Custom", shortLabel: "Custom", color: "text-zinc-400", bgColor: "bg-zinc-500/10", borderColor: "border-zinc-500/30", category: "basic" },
};

const DEFAULT_META: EnhancementMeta = {
  label: "Enhancement",
  shortLabel: "Enh",
  color: "text-zinc-400",
  bgColor: "bg-zinc-500/10",
  borderColor: "border-zinc-500/30",
  category: "basic",
};

export function getEnhancementMeta(type: string | null | undefined): EnhancementMeta {
  if (!type) return DEFAULT_META;
  return ENHANCEMENT_META[type] ?? { ...DEFAULT_META, label: type.replace(/_/g, " "), shortLabel: type.split("_")[0] };
}

const CATEGORY_ORDER: EnhancementMeta["category"][] = ["restoration", "basic", "filter", "video"];

export const ENHANCEMENT_CATEGORY_LABELS: Record<EnhancementMeta["category"], string> = {
  basic: "Photo polish",
  restoration: "AI restoration",
  filter: "Color & filters",
  video: "Video",
};

/**
 * Stable presentation weights so the strongest, safest defaults appear first.
 * Auto Face AI leads everywhere it's listed.
 */
const PRESENTATION_WEIGHT: Record<string, number> = {
  auto_face: 0,
  auto: 1,
  hybrid: 5,
  face_restore: 6,
  face_restore_hd: 7,
  codeformer: 8,
  esrgan_upscale_2x: 9,
  esrgan_upscale_4x: 10,
  old_photo_restore: 11,
};

/** Stable list for dashboard / marketing surfaces (every registered enhancement type). */
export function listEnhancementsForDashboard(): Array<{ id: string; meta: EnhancementMeta }> {
  return Object.entries(ENHANCEMENT_META)
    .map(([id, meta]) => ({ id, meta }))
    .sort((a, b) => {
      const ca = CATEGORY_ORDER.indexOf(a.meta.category);
      const cb = CATEGORY_ORDER.indexOf(b.meta.category);
      if (ca !== cb) return ca - cb;
      const wa = PRESENTATION_WEIGHT[a.id] ?? 100;
      const wb = PRESENTATION_WEIGHT[b.id] ?? 100;
      if (wa !== wb) return wa - wb;
      return a.meta.label.localeCompare(b.meta.label);
    });
}

/** Grouped sections for dashboard browse UI. */
export function groupEnhancementsForDashboardByCategory(): Array<{
  category: EnhancementMeta["category"];
  sectionTitle: string;
  items: Array<{ id: string; meta: EnhancementMeta }>;
}> {
  const flat = listEnhancementsForDashboard();
  const map = new Map<EnhancementMeta["category"], Array<{ id: string; meta: EnhancementMeta }>>();
  for (const row of flat) {
    const arr = map.get(row.meta.category) ?? [];
    arr.push(row);
    map.set(row.meta.category, arr);
  }
  return CATEGORY_ORDER.map((category) => ({
    category,
    sectionTitle: ENHANCEMENT_CATEGORY_LABELS[category],
    items: map.get(category) ?? [],
  })).filter((g) => g.items.length > 0);
}

export function enhancementStudioHref(id: string, category: EnhancementMeta["category"]): string {
  const q = encodeURIComponent(id);
  if (category === "video") return `/video-studio?enhance=${q}`;
  return `/photo-studio?enhance=${q}`;
}

export function formatProcessingTime(ms: number | null | undefined): string {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
