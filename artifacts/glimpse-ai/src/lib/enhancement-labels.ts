/**
 * enhancement-labels.ts — Human-readable labels, colors, and icons for enhancement types.
 * Used on dashboard, history, and analytics views.
 */

/**
 * Where an enhancement / filter can be applied.
 *
 * - "image"  — photo flow only.
 * - "video"  — video flow only.
 * - "both"   — usable in both Photo Studio and Video Studio. Cinematic and
 *              other color grades fall in this bucket: the same look applies
 *              cleanly to a still or a moving frame.
 * - "video-soon" — currently image-only, planned for video. Surfaces a
 *              "Video coming soon" hint on the chip / card so users know
 *              the feature is on the roadmap.
 */
export type AppliesTo = "image" | "video" | "both" | "video-soon";

export interface EnhancementMeta {
  label: string;
  shortLabel: string;
  color: string;       // Tailwind text color class
  bgColor: string;     // Tailwind bg color class
  borderColor: string; // Tailwind border color class
  category: "basic" | "restoration" | "video" | "filter";
  /** Surface the support matrix on dashboards / chips / cards. */
  appliesTo: AppliesTo;
}

const ENHANCEMENT_META: Record<string, EnhancementMeta> = {
  // Basic enhancements
  auto: { label: "Auto Enhance", shortLabel: "Auto", color: "text-teal-400", bgColor: "bg-teal-500/10", borderColor: "border-teal-500/30", category: "basic", appliesTo: "both" },
  portrait: { label: "Portrait", shortLabel: "Portrait", color: "text-pink-400", bgColor: "bg-pink-500/10", borderColor: "border-pink-500/30", category: "basic", appliesTo: "image" },
  skin: { label: "Skin Smooth", shortLabel: "Skin", color: "text-rose-400", bgColor: "bg-rose-500/10", borderColor: "border-rose-500/30", category: "basic", appliesTo: "image" },
  lighting: { label: "Lighting", shortLabel: "Light", color: "text-amber-400", bgColor: "bg-amber-500/10", borderColor: "border-amber-500/30", category: "basic", appliesTo: "image" },
  lighting_enhance: { label: "Lighting Enhance", shortLabel: "Light+", color: "text-amber-300", bgColor: "bg-amber-500/10", borderColor: "border-amber-500/30", category: "basic", appliesTo: "image" },
  color: { label: "Color Correct", shortLabel: "Color", color: "text-orange-400", bgColor: "bg-orange-500/10", borderColor: "border-orange-500/30", category: "basic", appliesTo: "image" },
  background: { label: "Background", shortLabel: "BG", color: "text-sky-400", bgColor: "bg-sky-500/10", borderColor: "border-sky-500/30", category: "basic", appliesTo: "image" },
  beauty: { label: "Beauty", shortLabel: "Beauty", color: "text-fuchsia-400", bgColor: "bg-fuchsia-500/10", borderColor: "border-fuchsia-500/30", category: "basic", appliesTo: "image" },
  upscale: { label: "Upscale 2×", shortLabel: "2×", color: "text-indigo-400", bgColor: "bg-indigo-500/10", borderColor: "border-indigo-500/30", category: "basic", appliesTo: "image" },
  upscale_4x: { label: "Upscale 4×", shortLabel: "4×", color: "text-indigo-300", bgColor: "bg-indigo-500/10", borderColor: "border-indigo-500/30", category: "basic", appliesTo: "image" },
  blur_background: { label: "Blur BG", shortLabel: "Blur", color: "text-sky-300", bgColor: "bg-sky-500/10", borderColor: "border-sky-500/30", category: "basic", appliesTo: "image" },
  posture: { label: "Posture", shortLabel: "Posture", color: "text-lime-400", bgColor: "bg-lime-500/10", borderColor: "border-lime-500/30", category: "basic", appliesTo: "image" },
  skin_retouch: { label: "Skin Retouch", shortLabel: "Retouch", color: "text-rose-300", bgColor: "bg-rose-500/10", borderColor: "border-rose-500/30", category: "basic", appliesTo: "image" },

  // Filters — cinematic + warm/cool grades intentionally cross both surfaces.
  filter: { label: "Filter", shortLabel: "Filter", color: "text-violet-400", bgColor: "bg-violet-500/10", borderColor: "border-violet-500/30", category: "filter", appliesTo: "both" },
  color_grade_cinematic: { label: "Cinematic Edit", shortLabel: "Cine", color: "text-violet-300", bgColor: "bg-violet-500/10", borderColor: "border-violet-500/30", category: "filter", appliesTo: "both" },
  color_grade_warm: { label: "Warm Grade", shortLabel: "Warm", color: "text-orange-300", bgColor: "bg-orange-500/10", borderColor: "border-orange-500/30", category: "filter", appliesTo: "both" },
  color_grade_cool: { label: "Cool Grade", shortLabel: "Cool", color: "text-cyan-300", bgColor: "bg-cyan-500/10", borderColor: "border-cyan-500/30", category: "filter", appliesTo: "both" },

  // AI Restoration — user-facing rebrand. The technical model names
  // (GFPGAN / CodeFormer / Hybrid GFPGAN+CodeFormer / Real-ESRGAN) live in
  // `FACE_RESTORATION_ADMIN` below and are rendered only inside admin-aware
  // tooltips at the call site. Underlying enhancement type IDs are unchanged
  // so the API contract, history records, and analytics keep working as-is.
  face_restore:      { label: "Classic Restore",     shortLabel: "Classic",    color: "text-emerald-400", bgColor: "bg-emerald-500/10", borderColor: "border-emerald-500/30", category: "restoration", appliesTo: "image" },
  face_restore_hd:   { label: "Classic Restore HD",  shortLabel: "Classic HD", color: "text-emerald-300", bgColor: "bg-emerald-500/10", borderColor: "border-emerald-500/30", category: "restoration", appliesTo: "image" },
  codeformer:        { label: "Detailed Refinement", shortLabel: "Detailed",   color: "text-emerald-200", bgColor: "bg-emerald-500/10", borderColor: "border-emerald-500/30", category: "restoration", appliesTo: "image" },
  hybrid:            { label: "Studio Restore",      shortLabel: "Studio",     color: "text-emerald-100", bgColor: "bg-emerald-500/10", borderColor: "border-emerald-500/30", category: "restoration", appliesTo: "image" },
  auto_face:         { label: "Auto Face",           shortLabel: "Auto",       color: "text-green-400",   bgColor: "bg-green-500/10",   borderColor: "border-green-500/30",   category: "restoration", appliesTo: "image" },
  esrgan_upscale_2x: { label: "Smart Upscale 2×",    shortLabel: "SR 2×",      color: "text-cyan-400",    bgColor: "bg-cyan-500/10",    borderColor: "border-cyan-500/30",    category: "restoration", appliesTo: "image" },
  esrgan_upscale_4x: { label: "Smart Upscale 4×",    shortLabel: "SR 4×",      color: "text-cyan-300",    bgColor: "bg-cyan-500/10",    borderColor: "border-cyan-500/30",    category: "restoration", appliesTo: "image" },
  old_photo_restore: { label: "Heritage Restore",    shortLabel: "Heritage",   color: "text-amber-300",   bgColor: "bg-amber-500/10",   borderColor: "border-amber-500/30",   category: "restoration", appliesTo: "image" },

  // Video
  video_restore: { label: "Video Restore", shortLabel: "Vid AI", color: "text-purple-400", bgColor: "bg-purple-500/10", borderColor: "border-purple-500/30", category: "video", appliesTo: "video" },
  trim: { label: "Trim", shortLabel: "Trim", color: "text-purple-300", bgColor: "bg-purple-500/10", borderColor: "border-purple-500/30", category: "video", appliesTo: "video" },
  stabilize: { label: "Stabilize", shortLabel: "Stab", color: "text-purple-200", bgColor: "bg-purple-500/10", borderColor: "border-purple-500/30", category: "video", appliesTo: "video" },
  custom: { label: "Custom", shortLabel: "Custom", color: "text-zinc-400", bgColor: "bg-zinc-500/10", borderColor: "border-zinc-500/30", category: "basic", appliesTo: "image" },
};

const DEFAULT_META: EnhancementMeta = {
  label: "Enhancement",
  shortLabel: "Enh",
  color: "text-zinc-400",
  bgColor: "bg-zinc-500/10",
  borderColor: "border-zinc-500/30",
  category: "basic",
  appliesTo: "image",
};

/**
 * Visual badge metadata for "Applies to" pills rendered next to enhancement
 * chips on the dashboard, browse library, and editor sidebar. The intent is
 * to make it unambiguous which features work on photos, videos, both, or are
 * still on the video roadmap — addressing the "Cinematic Edits applies to
 * both" clarification request.
 */
export interface AppliesToBadge {
  text: string;
  /** Tailwind chip palette tokens. */
  tone: string;
  /** Tooltip-suitable longer description. */
  hint: string;
}

export function appliesToBadge(applies: AppliesTo): AppliesToBadge {
  switch (applies) {
    case "both":
      return {
        text: "Photo + Video",
        tone: "border-cyan-500/40 bg-cyan-500/10 text-cyan-200",
        hint: "Works on photos and videos. Same look across stills and frames.",
      };
    case "video":
      return {
        text: "Video",
        tone: "border-purple-500/40 bg-purple-500/10 text-purple-200",
        hint: "Available in Video Studio.",
      };
    case "video-soon":
      return {
        text: "Video — Soon",
        tone: "border-amber-500/40 bg-amber-500/10 text-amber-200",
        hint: "Available for photos today; coming to Video Studio next.",
      };
    case "image":
    default:
      return {
        text: "Photo",
        tone: "border-teal-500/40 bg-teal-500/10 text-teal-200",
        hint: "Works on photos.",
      };
  }
}

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

/**
 * Public-facing video roadmap. Surfaced inside the Video Studio + dashboard
 * Video card so users can see where we're going while we close the gap with
 * the photo flow. Keep this list short and honest — over-promising erodes
 * trust faster than missing a feature.
 */
export interface VideoRoadmapItem {
  title: string;
  status: "live" | "next" | "exploring";
  blurb: string;
}

export const VIDEO_ROADMAP: ReadonlyArray<VideoRoadmapItem> = [
  { title: "Trim & cut",                 status: "live",      blurb: "Precise frame trim with a draggable timeline scrubber." },
  { title: "Stabilization",              status: "live",      blurb: "Reduce shake on handheld and action footage." },
  { title: "AI Video Restore",           status: "live",      blurb: "Multi-frame denoise + sharpening for low-quality clips." },
  { title: "Color grades (Cinematic, Warm, Cool, Vintage, Vivid, B&W)", status: "live", blurb: "The same color science as the photo flow — matched 1:1 across stills and frames." },
  { title: "Auto Face on video",         status: "next",      blurb: "Per-frame face restoration. Photo flow ships GFPGAN/CodeFormer; video parity is in active integration." },
  { title: "AI Upscale 2× / 4× on video", status: "next",      blurb: "Real-ESRGAN per-frame upscaling. Photo flow already supports 4×; video pipeline is queued." },
  { title: "Background blur / replace",  status: "exploring", blurb: "Mask-tracked separation. Researching the right balance of speed and quality before commit." },
  { title: "Voice-aware cuts",           status: "exploring", blurb: "Auto-cut silences and filler words for talking-head footage." },
];

// ---------------------------------------------------------------------------
// Face restoration — user-facing rebrand
// ---------------------------------------------------------------------------
// End users see calm, intuitive names ("Classic Restore", "Detailed Refinement",
// "Studio Restore"). Admins additionally see the underlying model + pipeline
// detail in the same tooltip / surface, so they can audit which technical
// pipeline ran without the open-source names leaking to the public UI.
//
// Underlying enhancement type IDs (auto_face / face_restore / codeformer /
// hybrid / old_photo_restore) are UNCHANGED — only the display layer changes,
// so the API contract, history records, and analytics keep working as-is.
// ---------------------------------------------------------------------------

export interface FaceRestorationDisplay {
  /** Rebranded label safe for any audience. */
  label: string;
  /** Short blurb that explains the *result*, never the model. */
  desc: string;
  /** Pipeline detail — only rendered when the viewer is an admin. */
  technical?: string;
}

const FACE_RESTORATION_USER: Record<string, FaceRestorationDisplay> = {
  auto_face:         { label: "Auto Face",          desc: "Smart auto: applies face-aware restoration only when the photo looks old or damaged. Clean portraits get a gentle natural enhance." },
  face_restore:      { label: "Classic Restore",    desc: "Restores soft facial details with natural skin tones — best for everyday portraits." },
  face_restore_hd:   { label: "Classic Restore HD", desc: "Higher-resolution variant of Classic Restore for large prints or detailed faces." },
  codeformer:        { label: "Detailed Refinement", desc: "Reconstructs sharper identity for low-resolution, pixelated, or compressed faces." },
  hybrid:            { label: "Studio Restore",     desc: "Highest quality face cleanup — combines two approaches for damaged or aged photos." },
  old_photo_restore: { label: "Heritage Restore",   desc: "Reduces age marks, scratches, and noise on heritage or vintage photos." },
};

const FACE_RESTORATION_ADMIN: Record<string, FaceRestorationDisplay> = {
  auto_face:         { label: "Auto Face",          desc: FACE_RESTORATION_USER.auto_face.desc,         technical: "Per-photo quality probe: clean portraits skip face restoration entirely. Damaged portraits auto-route to GFPGAN, CodeFormer, or Hybrid based on detected degradation." },
  face_restore:      { label: "Classic Restore",    desc: FACE_RESTORATION_USER.face_restore.desc,      technical: "GFPGAN — natural skin tones, restores soft facial detail." },
  face_restore_hd:   { label: "Classic Restore HD", desc: FACE_RESTORATION_USER.face_restore_hd.desc,   technical: "GFPGAN-HD — higher input resolution face cleanup." },
  codeformer:        { label: "Detailed Refinement", desc: FACE_RESTORATION_USER.codeformer.desc,       technical: "CodeFormer — sharper identity reconstruction for low-res / pixelated faces." },
  hybrid:            { label: "Studio Restore",     desc: FACE_RESTORATION_USER.hybrid.desc,            technical: "Hybrid pipeline: GFPGAN + CodeFormer combined for maximum face quality." },
  old_photo_restore: { label: "Heritage Restore",   desc: FACE_RESTORATION_USER.old_photo_restore.desc, technical: "Hybrid restoration + descratch median + adaptive contrast + warm tint." },
};

export function getFaceRestorationDisplay(type: string | null | undefined, isAdmin: boolean): FaceRestorationDisplay {
  if (!type) return { label: "Face Restoration", desc: "" };
  const map = isAdmin ? FACE_RESTORATION_ADMIN : FACE_RESTORATION_USER;
  return map[type] ?? { label: getEnhancementMeta(type).label, desc: "" };
}
