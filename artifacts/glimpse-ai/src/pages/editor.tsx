import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import Layout from "../components/layout";
import { useAuth } from "../lib/auth-context";
import {
  useUploadMedia,
  useEnhanceMedia,
  useAnalyzeMedia,
  useListPresets,
  useGetMediaJob,
  UploadMediaBodyMediaType,
  EnhanceMediaBodyEnhancementType,
} from "@workspace/api-client-react";
import {
  CANONICAL_FILTERS_BY_ID,
  CANONICAL_FILTER_REGISTRY,
  DEFAULT_CROP_BOX,
  DEFAULT_FILTER_STATE,
  DEFAULT_TRANSFORM_STATE,
  type CropBox,
  type FilterState,
  type TransformState,
} from "@workspace/filter-registry";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { saveToHistory } from "@/lib/local-history";
import { buildEnhancedDownloadName } from "@/lib/export-filename";
import { buildStoreZip, base64ToBytes, type ZipEntry } from "@/lib/zip-store";
import { getEnhancementMeta, getFaceRestorationDisplay, VIDEO_ROADMAP } from "@/lib/enhancement-labels";
import { describeQuotaError } from "@/components/usage-summary";
import { ProgressTimeline } from "@/components/progress-timeline";
import { supportMailto } from "@/lib/support";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  UploadCloud,
  Wand2,
  Image as ImageIcon,
  Video,
  Settings2,
  Download,
  RefreshCw,
  Sparkles,
  Loader2,
  RotateCw,
  RotateCcw,
  FlipHorizontal2,
  FlipVertical2,
  Crop,
  SlidersHorizontal,
  CheckCircle2,
  AlertCircle,
  ZoomIn,
  ZoomOut,
  Palette,
  Film,
  Sun,
  Zap,
  Eye,
  Camera,
  X,
  ChevronLeft,
  ChevronRight,
  Thermometer,
  Droplets,
  Mountain,
  Focus,
  Layers,
  Paintbrush,
  Contrast,
  CircleDot,
  ScanEye,
  ScanFace,
  ImageUp,
  Undo2,
  MessageSquare,
  Send,
  Scissors,
  Volume2,
  VolumeX,
  Clock,
  Gauge,
  Lock,
  ArrowLeftRight,
  Crown,
} from "lucide-react";
import { Input } from "@/components/ui/input";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProcessStage = "idle" | "uploading" | "processing" | "completed" | "failed";
type EditorMode = "simple" | "advanced";

interface AISuggestion {
  description: string;
  suggestedEnhancement: string;
  suggestedFilter?: string | null;
  detectedSubjects: string[];
  confidence: number;
  /**
   * Where the recommended enhancement will run.
   *  - "sidecar": restoration Python service (Docker / native) is reachable
   *    and exposes the premium model.
   *  - "native":  Sharp-only fallback (no Docker required); for face scenes
   *    this still produces a usable result.
   *  - "unknown": not yet probed.
   */
  servedBy?: "sidecar" | "native" | "unknown";
}

interface EditorSnapshot {
  filters: FilterState;
  transform: TransformState;
  cropBox: CropBox;
  cropEnabled: boolean;
  selectedFilter: string | null;
  skinSmoothing: number;
  enhancementType: EnhanceMediaBodyEnhancementType;
}

interface ChatMessage {
  id: number;
  role: "ai" | "user";
  text: string;
  action?: { type: EnhanceMediaBodyEnhancementType; filter?: string };
  applied?: boolean;
}

interface CanonicalPreviewResponse {
  base64: string;
  mimeType: string;
  filterId?: string | null;
  filterVersion?: string | null;
  renderKind: "preview";
  width?: number;
  height?: number;
}

interface FilterPreset {
  name: string;
  key: string;
  f: FilterState;
  serverFilter: string | null;
  version: string;
  gradient: string;
  premium: boolean;
  cssExtra?: string;
}

// ---------------------------------------------------------------------------
// Defaults & constants
// ---------------------------------------------------------------------------

const DEFAULT_FILTERS: FilterState = DEFAULT_FILTER_STATE;
const DEFAULT_TRANSFORM: TransformState = DEFAULT_TRANSFORM_STATE;
const DEFAULT_CROP: CropBox = DEFAULT_CROP_BOX;
const MAX_FILE_MB = 100;
const ONBOARDING_KEY = "glimpse_onboarding_done";

/** Must match server `RESTORATION_TYPES` in image-enhancer — keep enhancement + stylistic filter */
const RESTORATION_ENHANCEMENT_TYPES = new Set<string>([
  "face_restore",
  "face_restore_hd",
  "codeformer",
  "auto_face",
  "hybrid",
  "esrgan_upscale_2x",
  "esrgan_upscale_4x",
  "old_photo_restore",
]);

const FILTER_PRESETS: FilterPreset[] = CANONICAL_FILTER_REGISTRY.map((filter): FilterPreset => ({
  name: filter.name,
  key: filter.id,
  f: filter.previewState,
  serverFilter: filter.id === "original" ? null : filter.id,
  version: filter.version,
  gradient: filter.gradient,
  premium: filter.tier === "premium",
  cssExtra: filter.previewCssExtra,
}));

const FILTER_PRESETS_BY_KEY = new Map<string, FilterPreset>(
  FILTER_PRESETS.map((preset) => [preset.key, preset] as const),
);

// -- Simple-mode one-click presets (expanded) --
// Auto Face AI leads: it auto-selects the best face model (GFPGAN / CodeFormer / hybrid)
// based on detected degradation and is the safest, highest-quality default for everyone.
// User-facing presets. Face restoration entries use the rebranded labels
// ("Classic Restore", "Detailed Refinement", "Studio Restore", "Heritage
// Restore") — technical model names (GFPGAN / CodeFormer / Hybrid) live in
// admin-only tooltip detail rendered at the call site via
// `getFaceRestorationDisplay(type, isAdmin)`. Underlying enhancement type
// IDs are unchanged so the API/history contract is preserved.
const SIMPLE_PRESETS: { type: EnhanceMediaBodyEnhancementType; label: string; desc: string; icon: React.ReactNode; filterName?: string }[] = [
  { type: "auto_face",               label: "Auto Face",           desc: "Smart auto — face restoration only kicks in for old or damaged photos. Clean portraits get a gentle natural enhance.",  icon: <Sparkles     className="w-5 h-5" /> },
  { type: "auto",                   label: "Auto Enhance",         desc: "AI-powered one-click fix",                            icon: <Wand2        className="w-5 h-5" /> },
  { type: "portrait",               label: "Portrait Polish",      desc: "Smooth skin & warm tones",                            icon: <Eye          className="w-5 h-5" /> },
  { type: "lighting_enhance",       label: "Fix Lighting",         desc: "Mood-aware shadow & highlight fix",                   icon: <Sun          className="w-5 h-5" /> },
  { type: "color_grade_cinematic",  label: "Cinematic Grade",      desc: "Film-grade color grading",                            icon: <Film         className="w-5 h-5" /> },
  { type: "color_grade_warm",       label: "Warm Tones",           desc: "Golden, warm color palette",                          icon: <Thermometer  className="w-5 h-5" /> },
  { type: "color_grade_cool",       label: "Cool Tones",           desc: "Crisp, blue-shift palette",                           icon: <Droplets     className="w-5 h-5" /> },
  { type: "blur_background",        label: "Background Blur",      desc: "Intelligent portrait bokeh",                          icon: <Focus        className="w-5 h-5" /> },
  { type: "skin_retouch",           label: "Skin Retouch",         desc: "Smooth skin with natural detail",                     icon: <Paintbrush   className="w-5 h-5" /> },
  { type: "upscale",                label: "2x Upscale",           desc: "Double resolution with AI",                           icon: <ZoomIn       className="w-5 h-5" /> },
  { type: "upscale_4x",             label: "4x Upscale",           desc: "Quadruple resolution (pro)",                          icon: <Layers       className="w-5 h-5" /> },
  { type: "face_restore",            label: "Classic Restore",      desc: "Natural skin tones + soft facial detail recovery",    icon: <ScanFace     className="w-5 h-5" /> },
  { type: "codeformer",              label: "Detailed Refinement",  desc: "Sharper identity for low-resolution / pixelated faces", icon: <ScanEye      className="w-5 h-5" /> },
  { type: "hybrid",                  label: "Studio Restore",       desc: "Highest quality face cleanup — combined approach",    icon: <Sparkles     className="w-5 h-5" /> },
  { type: "old_photo_restore",       label: "Heritage Restore",     desc: "Reduce age marks, scratches & noise on old photos",   icon: <ImageUp      className="w-5 h-5" /> },
  { type: "esrgan_upscale_2x",       label: "Smart Upscale 2x",     desc: "AI super-resolution 2×",                              icon: <ZoomIn       className="w-5 h-5" /> },
  { type: "esrgan_upscale_4x",       label: "Smart Upscale 4x",     desc: "AI super-resolution 4×",                              icon: <Layers       className="w-5 h-5" /> },
];

const STAGE_INFO: Record<ProcessStage, { label: string; colorClass: string }> = {
  idle:       { label: "",              colorClass: "" },
  uploading:  { label: "Uploading...", colorClass: "text-blue-400" },
  processing: { label: "Processing...", colorClass: "text-amber-400" },
  completed:  { label: "Complete!",    colorClass: "text-teal-400" },
  failed:     { label: "Failed",       colorClass: "text-red-400" },
};

// ---------------------------------------------------------------------------
// AI Analytics helpers — persist suggestion outcomes to localStorage
// ---------------------------------------------------------------------------

const AI_ANALYTICS_KEY = "glimpse_ai_analytics";

interface AiAnalyticsEvent {
  ts: number;
  action: "applied" | "dismissed" | "ignored";
  enhancement: string;
  filter?: string;
  imageType: string; // inferred from detectedSubjects
  confidence: number;
}

function trackAiEvent(evt: AiAnalyticsEvent) {
  try {
    const raw = localStorage.getItem(AI_ANALYTICS_KEY);
    const log: AiAnalyticsEvent[] = raw ? JSON.parse(raw) : [];
    log.push(evt);
    // Keep last 500 events
    if (log.length > 500) log.splice(0, log.length - 500);
    localStorage.setItem(AI_ANALYTICS_KEY, JSON.stringify(log));
  } catch { /* quota exceeded — silently skip */ }

  // Also POST to server-side self-learning feedback loop (fire-and-forget)
  if (evt.action === "applied" || evt.action === "dismissed") {
    const token = localStorage.getItem("glimpse_token");
    if (token) {
      fetch("/api/media/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enhancement: evt.enhancement, action: evt.action }),
      }).catch(() => { /* non-critical, ignore network errors */ });
    }
  }
}

function inferImageType(subjects: string[]): string {
  const lower = subjects.map(s => s.toLowerCase());
  if (lower.some(s => s.includes("person") || s.includes("face") || s.includes("portrait"))) return "portrait";
  if (lower.some(s => s.includes("landscape") || s.includes("mountain") || s.includes("sky") || s.includes("nature"))) return "landscape";
  if (lower.some(s => s.includes("food") || s.includes("dish") || s.includes("meal"))) return "food";
  if (lower.some(s => s.includes("animal") || s.includes("pet") || s.includes("dog") || s.includes("cat"))) return "animal";
  if (lower.some(s => s.includes("architecture") || s.includes("building") || s.includes("city"))) return "architecture";
  if (lower.some(s => s.includes("product") || s.includes("object") || s.includes("item"))) return "product";
  return "general";
}

/** Derive alternative enhancement suggestions based on image type */
function getAlternatives(imageType: string, primary: string): { type: EnhanceMediaBodyEnhancementType; label: string }[] {
  const pool: Record<string, { type: EnhanceMediaBodyEnhancementType; label: string }[]> = {
    portrait: [
      { type: "auto_face", label: "Auto-Face" },
      { type: "color_grade_cinematic", label: "Cinematic Grade" },
      { type: "color_grade_warm", label: "Warm Tones" },
      { type: "lighting_enhance", label: "Fix Lighting" },
      { type: "skin_retouch", label: "Skin Retouch" },
      { type: "blur_background", label: "Background Blur" },
    ],
    landscape: [
      { type: "auto", label: "Auto Enhance" },
      { type: "color_grade_cinematic", label: "Cinematic" },
      { type: "lighting_enhance", label: "Fix Lighting" },
      { type: "upscale", label: "2x Upscale" },
      { type: "color", label: "Color Pop" },
    ],
    food: [
      { type: "auto", label: "Auto Enhance" },
      { type: "color_grade_warm", label: "Warm Tones" },
      { type: "lighting_enhance", label: "Fix Lighting" },
      { type: "color", label: "Color Pop" },
    ],
    general: [
      { type: "auto", label: "Auto Enhance" },
      { type: "upscale", label: "2x Upscale" },
      { type: "lighting_enhance", label: "Fix Lighting" },
      { type: "color_grade_cinematic", label: "Cinematic" },
      { type: "color", label: "Color Pop" },
    ],
  };
  const list = pool[imageType] ?? pool.general;
  return list.filter(a => a.type !== primary).slice(0, 3);
}

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

function buildCssFilter(f: FilterState, cssExtra?: string): string {
  const blurPx = f.sharpness < 100 ? ((100 - f.sharpness) / 100) * 3 : 0;
  const hueRot = f.hue ?? 0;
  const warmthShift = f.warmth ?? 0;
  const parts = [
    `brightness(${f.brightness}%)`,
    `contrast(${f.contrast}%)`,
    `saturate(${f.saturation}%)`,
    blurPx > 0 ? `blur(${blurPx.toFixed(2)}px)` : "",
    hueRot !== 0 ? `hue-rotate(${hueRot}deg)` : "",
    warmthShift > 0 ? `sepia(${Math.min(warmthShift * 2, 50)}%)` : "",
    warmthShift < 0 ? `hue-rotate(${Math.max(warmthShift * 3, -60)}deg)` : "",
    // cssExtra = per-filter CSS string that approximates Sharp's .tint() / .gamma()
    (cssExtra ?? "").replace(/^filter:\s*/, ""),
  ];
  return parts.filter(Boolean).join(" ");
}

function buildPreviewStyle(
  transform: TransformState,
  filters: FilterState,
  crop: CropBox,
  cssExtra?: string,
): React.CSSProperties {
  const t: string[] = [];
  if (transform.rotation) t.push(`rotate(${transform.rotation}deg)`);
  if (transform.flipH) t.push("scaleX(-1)");
  if (transform.flipV) t.push("scaleY(-1)");
  const { x, y, x2, y2 } = crop;
  const hasCrop = x !== 0 || y !== 0 || x2 !== 100 || y2 !== 100;
  return {
    filter: buildCssFilter(filters, cssExtra),
    transform: t.length ? t.join(" ") : undefined,
    clipPath: hasCrop ? `inset(${y}% ${100 - x2}% ${100 - y2}% ${x}%)` : undefined,
    transition: "filter 0.2s ease, transform 0.2s ease",
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isDefaultCropBox(crop: CropBox): boolean {
  return crop.x === 0 && crop.y === 0 && crop.x2 === 100 && crop.y2 === 100;
}

function mergePreviewFilterState(
  manualFilters: FilterState,
  selectedFilterId: string | null,
): FilterState {
  const presetFilters = selectedFilterId
    ? (FILTER_PRESETS_BY_KEY.get(selectedFilterId)?.f ?? DEFAULT_FILTERS)
    : DEFAULT_FILTERS;

  return {
    brightness: clamp(presetFilters.brightness + (manualFilters.brightness - 100), 0, 200),
    contrast: clamp(presetFilters.contrast + (manualFilters.contrast - 100), 0, 200),
    saturation: clamp(presetFilters.saturation + (manualFilters.saturation - 100), 0, 200),
    sharpness: clamp(presetFilters.sharpness + (manualFilters.sharpness - 100), 0, 200),
    warmth: clamp(presetFilters.warmth + manualFilters.warmth, -100, 100),
    highlights: clamp(presetFilters.highlights + manualFilters.highlights, -100, 100),
    shadows: clamp(presetFilters.shadows + manualFilters.shadows, -100, 100),
    hue: clamp(presetFilters.hue + manualFilters.hue, -180, 180),
  };
}

async function applyTransformsToBase64(
  file: File,
  transform: TransformState,
  crop: CropBox,
  filters: FilterState,
  cssExtra?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const sw = img.naturalWidth;
        const sh = img.naturalHeight;
        const cx = (crop.x / 100) * sw;
        const cy = (crop.y / 100) * sh;
        const cw = Math.max(1, ((crop.x2 - crop.x) / 100) * sw);
        const ch = Math.max(1, ((crop.y2 - crop.y) / 100) * sh);
        const rotated = transform.rotation === 90 || transform.rotation === 270;
        const canvasW = rotated ? ch : cw;
        const canvasH = rotated ? cw : ch;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(canvasW);
        canvas.height = Math.round(canvasH);
        const ctx = canvas.getContext("2d")!;
        ctx.filter = buildCssFilter(filters, cssExtra);
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((transform.rotation * Math.PI) / 180);
        ctx.scale(transform.flipH ? -1 : 1, transform.flipV ? -1 : 1);
        ctx.drawImage(img, cx, cy, cw, ch, -cw / 2, -ch / 2, cw, ch);
        ctx.restore();
        resolve(canvas.toDataURL("image/jpeg", 0.92).split(",")[1]);
      } catch (err) { reject(err); }
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// Onboarding Walkthrough
// ---------------------------------------------------------------------------

interface WalkthroughStep {
  title: string;
  description: string;
  icon: React.ReactNode;
}

const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  { title: "Upload Your Media",  description: "Drag & drop or click to upload photos and videos up to 100 MB. We support all major formats.", icon: <UploadCloud className="w-8 h-8 text-teal-400" /> },
  { title: "Pick a Style",       description: "Choose from 15+ filter presets or use AI-powered enhancements. In Simple mode, just tap a preset for instant results.", icon: <Palette className="w-8 h-8 text-teal-400" /> },
  { title: "Enhance with AI",    description: "Hit Enhance and our AI processes your media server-side using professional-grade algorithms.", icon: <Sparkles className="w-8 h-8 text-amber-400" /> },
  { title: "Export Your Result",  description: "Download your enhanced media instantly. Switch to Advanced mode anytime for granular controls.", icon: <Download className="w-8 h-8 text-blue-400" /> },
];

function OnboardingWalkthrough({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const current = WALKTHROUGH_STEPS[step];
  const isLast = step === WALKTHROUGH_STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-white/10 rounded-2xl max-w-md w-full p-8 relative shadow-2xl">
        <button onClick={onComplete} className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-300 transition-colors">
          <X className="w-5 h-5" />
        </button>

        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center">
            {current.icon}
          </div>
        </div>

        <h3 className="text-xl font-bold text-center mb-2">{current.title}</h3>
        <p className="text-sm text-zinc-400 text-center mb-8 leading-relaxed">{current.description}</p>

        <div className="flex justify-center gap-2 mb-6">
          {WALKTHROUGH_STEPS.map((_, i) => (
            <div key={i} className={cn("w-2 h-2 rounded-full transition-all", i === step ? "bg-teal-500 w-6" : "bg-zinc-700")} />
          ))}
        </div>

        <div className="flex gap-3">
          {step > 0 && (
            <Button variant="outline" className="flex-1 border-zinc-700" onClick={() => setStep(step - 1)}>
              <ChevronLeft className="w-4 h-4 mr-1" />Back
            </Button>
          )}
          <Button className={cn("flex-1 bg-teal-600 hover:bg-teal-700 text-white", step === 0 && "w-full")}
            onClick={() => isLast ? onComplete() : setStep(step + 1)}>
            {isLast ? "Get Started" : <>Next<ChevronRight className="w-4 h-4 ml-1" /></>}
          </Button>
        </div>

        <button onClick={onComplete} className="mt-4 text-xs text-zinc-600 hover:text-zinc-400 mx-auto block transition-colors">
          Skip walkthrough
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Editor
// ---------------------------------------------------------------------------

export default function Editor() {
  // Route-based studio mode
  const [location] = useLocation();
  const studioMode: "photo" | "video" = location.includes("video-studio") ? "video" : "photo";

  // ─── Tier-awareness ────────────────────────────────────────
  const { user } = useAuth();
  const planSlug: string | null = (user as any)?.planSlug ?? null;
  const isAdmin = user?.role === "admin";
  // Premium-only features
  const PREMIUM_FEATURES = new Set([
    "upscale_4x",
    "posture",
    "codeformer",
    "hybrid",
    "face_restore_hd",
    "esrgan_upscale_4x",
    "video_restore",
  ]);
  const RESTORATION_FEATURES = new Set(["face_restore", "codeformer", "hybrid", "auto_face", "old_photo_restore", "esrgan_upscale_2x", "esrgan_upscale_4x", "face_restore_hd"]);
  const BASIC_PLUS_FEATURES = new Set(["stabilize", "trim"]);
  const PREMIUM_FILTER_KEYS = new Set(
    FILTER_PRESETS.filter((preset) => preset.premium).map((preset) => preset.key),
  );
  const canAccessPremium = isAdmin || planSlug === "premium";
  const canAccessBasic = canAccessPremium || planSlug === "basic";

  const isFeatureLocked = (featureType: string, filterKey?: string): boolean => {
    if (isAdmin) return false;
    if (PREMIUM_FEATURES.has(featureType)) return !canAccessPremium;
    if (BASIC_PLUS_FEATURES.has(featureType)) return !canAccessBasic;
    if (featureType === "filter" && filterKey && PREMIUM_FILTER_KEYS.has(filterKey)) return !canAccessPremium;
    return false;
  };

  const tierLabel = (featureType: string): string => {
    if (PREMIUM_FEATURES.has(featureType)) return "Premium";
    if (BASIC_PLUS_FEATURES.has(featureType)) return "Basic";
    return "Premium";
  };

  // Onboarding
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem(ONBOARDING_KEY));
  const completeOnboarding = () => { localStorage.setItem(ONBOARDING_KEY, "1"); setShowOnboarding(false); };

  // Mode toggle — video studio defaults to advanced
  const [editorMode, setEditorMode] = useState<EditorMode>(studioMode === "video" ? "advanced" : "simple");

  // Media state — default mediaType matches studio route
  const [file, setFile] = useState<File | null>(null);
  const [base64Data, setBase64Data] = useState<string>("");
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [canonicalPreviewUrl, setCanonicalPreviewUrl] = useState<string | null>(null);
  const [isRenderingPreview, setIsRenderingPreview] = useState(false);
  const [mediaType, setMediaType] = useState<UploadMediaBodyMediaType>(studioMode === "video" ? "video" : "photo");
  // Deep-link: /photo-studio?enhance=upscale_4x preselects the enhancement type (from the new Dashboard hub)
  const initialEnhanceFromQuery = React.useMemo<EnhanceMediaBodyEnhancementType | null>(() => {
    if (typeof window === "undefined") return null;
    const q = new URLSearchParams(window.location.search).get("enhance");
    return (q as EnhanceMediaBodyEnhancementType) || null;
  }, []);
  const defaultEnhancementForStudio = React.useMemo<EnhanceMediaBodyEnhancementType>(() => {
    if (initialEnhanceFromQuery) return initialEnhanceFromQuery;
    /** Video: trim is tier-safe; premium users choose AI Enhance. Photo: auto-select face model baseline. */
    return studioMode === "video" ? "trim" : "auto_face";
  }, [initialEnhanceFromQuery, studioMode]);
  const [enhancementType, setEnhancementType] = useState<EnhanceMediaBodyEnhancementType>(defaultEnhancementForStudio);
  const [selectedFilter, setSelectedFilter] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<number | undefined>(undefined);
  const [currentJobId, setCurrentJobId] = useState<number | null>(null);
  const [processStage, setProcessStage] = useState<ProcessStage>("idle");

  // Auto-process trigger: when set, the next render's useEffect calls
  // handleProcess() with the latest enhancementType / selectedFilter / upscaleAfter
  // closures. Used by "Apply: auto_face" / "Or try" alternatives / filter chips
  // / upscale chips to behave as one-click actions. The ref + counter pattern
  // ensures the same trigger source can fire multiple times in a session.
  const pendingAutoProcessRef = useRef<{ source: string } | null>(null);
  const [autoProcessTick, setAutoProcessTick] = useState(0);

  // Image zoom
  const [zoomLevel, setZoomLevel] = useState(1);
  // Pan offset in CSS pixels — only meaningful when zoomLevel > 1, otherwise
  // the image fits the frame and panning is a no-op. The handlers below
  // attach to every image preview path (single, split-compare, batch hero)
  // so the experience is uniform: click-drag to move, release to settle.
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const zoomIn = () => setZoomLevel((z) => Math.min(z + 0.25, 4));
  const zoomOut = () =>
    setZoomLevel((z) => {
      const next = Math.max(z - 0.25, 0.25);
      if (next <= 1) setPanOffset({ x: 0, y: 0 });
      return next;
    });
  const zoomReset = () => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
  };
  const canPan = zoomLevel > 1;
  const panHandlers = useMemo(
    () => ({
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        if (zoomLevel <= 1) return;
        setIsPanning(true);
        panStartRef.current = { x: e.clientX, y: e.clientY, ox: panOffset.x, oy: panOffset.y };
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
      },
      onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
        if (!panStartRef.current) return;
        const { x, y, ox, oy } = panStartRef.current;
        setPanOffset({ x: ox + (e.clientX - x), y: oy + (e.clientY - y) });
      },
      onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
        if (!panStartRef.current) return;
        panStartRef.current = null;
        setIsPanning(false);
        try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
      },
      onPointerCancel: () => {
        panStartRef.current = null;
        setIsPanning(false);
      },
    }),
    [zoomLevel, panOffset.x, panOffset.y],
  );
  // Combined zoom + pan transform — preserves the existing scale-only behaviour
  // when zoomLevel === 1, so single-file previews look unchanged from before.
  const zoomTransform = `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`;
  const zoomTransition = isPanning ? "none" : "transform 0.2s";
  const panCursor = canPan ? (isPanning ? "grabbing" : "grab") : "default";
  // Advanced controls
  const [transform, setTransform] = useState<TransformState>(DEFAULT_TRANSFORM);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [cropBox, setCropBox] = useState<CropBox>(DEFAULT_CROP);
  const [cropEnabled, setCropEnabled] = useState(false);
  const [stabilize, setStabilize] = useState(false);
  const [denoise, setDenoise] = useState(false);
  const [skinSmoothing, setSkinSmoothing] = useState(50);
  // Video editing controls
  const [videoSpeed, setVideoSpeed] = useState(1.0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(100);
  const [muteAudio, setMuteAudio] = useState(false);
  const [videoColorGrade, setVideoColorGrade] = useState<string | null>(null);

  // AI Analysis
  const [aiSuggestion, setAiSuggestion] = useState<AISuggestion | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [splitCompare, setSplitCompare] = useState(false);

  // Undo stack
  const [undoStack, setUndoStack] = useState<EditorSnapshot[]>([]);

  // AI Chat panel
  const [showAiChat, setShowAiChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const chatIdRef = useRef(0);

  // Filter gallery scroll
  const [showAllFilters, setShowAllFilters] = useState(false);

  // AI Power-Up panel (below image)
  const [showPowerUp, setShowPowerUp] = useState(false);

  // Combo enhancement: upscale after primary enhancement
  const [upscaleAfter, setUpscaleAfter] = useState<"upscale" | "upscale_4x" | null>(null);
  const upscaleChainRef = useRef(false); // tracks whether we're in chained upscale step
  const pendingExportRef = useRef(false);  // auto-download after process+export flow
  const previewRequestSeqRef = useRef(0);

  // ── Batch mode (multi-file enhancement) ───────────────────────────────
  // Activated by ?mode=batch deep-link from the dashboard Batch action card.
  // The dashboard stashes selected files in sessionStorage:glimpse:pending-batch;
  // we pick them up on mount, render a queue panel, and on "Process Batch"
  // upload each file (one at a time) then call /media/enhance-batch with the
  // full jobIds[] array using the shared (enhance / filter / upscale) spec.
  const isBatchMode = React.useMemo(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("mode") === "batch";
  }, []);
  type BatchItem = {
    id: string;
    name: string;
    type: string;
    dataUrl: string;
    jobId: number | null;
    status: "queued" | "uploading" | "processing" | "completed" | "failed";
    error?: string;
  };
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  // Which queued image is rendered as the live "sample" preview. Filters and
  // CSS adjustments are applied to this image in real time, locally — no API
  // calls are made for filter/preset switching. Only Process Batch hits the
  // server. We index into the photo-only subset (videos can't be CSS-previewed).
  const [batchPreviewIndex, setBatchPreviewIndex] = useState(0);

  const { toast } = useToast();

  // Push current state to undo stack before making changes
  const pushUndo = useCallback(() => {
    setUndoStack(s => [
      ...s.slice(-19),
      { filters, transform, cropBox, cropEnabled, selectedFilter, skinSmoothing, enhancementType },
    ]);
  }, [filters, transform, cropBox, cropEnabled, selectedFilter, skinSmoothing, enhancementType]);

  // Restore previous state from undo stack
  const handleUndo = useCallback(() => {
    setUndoStack(s => {
      if (s.length === 0) return s;
      const prev = s[s.length - 1];
      setFilters(prev.filters);
      setTransform(prev.transform);
      setCropBox(prev.cropBox);
      setCropEnabled(prev.cropEnabled);
      setSelectedFilter(prev.selectedFilter);
      setSkinSmoothing(prev.skinSmoothing);
      setEnhancementType(prev.enhancementType);
      return s.slice(0, -1);
    });
  }, []);

  const enhanceMedia = useEnhanceMedia();
  const uploadMedia = useUploadMedia();
  const analyzeMedia = useAnalyzeMedia();
  const { data: presets } = useListPresets({ type: mediaType });
  const pollCountRef = useRef(0);
  const { data: currentJob } = useGetMediaJob(currentJobId as number, {
    query: {
      enabled: !!currentJobId,
      queryKey: ["mediaJob", currentJobId],
      refetchInterval: (query) => {
        const s = query.state.data?.status;
        if (s === "completed" || s === "failed") {
          pollCountRef.current = 0;
          return false;
        }
        // Fast initial polls (1s) to catch quick Sharp enhancements, then backoff
        pollCountRef.current += 1;
        if (pollCountRef.current > 150) return false;
        if (pollCountRef.current <= 3) return 1000; // First 3 polls: 1s
        return Math.min(2000 * Math.pow(1.4, Math.min(pollCountRef.current - 4, 7)), 12000);
      },
    },
  });

  // Reset poll count when a new job starts
  useEffect(() => {
    if (currentJobId) pollCountRef.current = 0;
  }, [currentJobId]);

  // ── Dashboard deep-link: pick up a file stashed in sessionStorage by the
  //    new landing Dashboard hub (ActionCard drag-drop or upload button).
  //    Runs once on mount — the key is consumed so re-navigation is clean.
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Batch deep-link wins over single — drains glimpse:pending-batch.
    const rawBatch = sessionStorage.getItem("glimpse:pending-batch");
    if (rawBatch) {
      sessionStorage.removeItem("glimpse:pending-batch");
      try {
        const parsed = JSON.parse(rawBatch) as Array<{ name: string; type: string; dataUrl: string }>;
        if (Array.isArray(parsed) && parsed.length > 0) {
          setBatchItems(
            parsed.map((p, idx) => ({
              id: `batch-${Date.now()}-${idx}`,
              name: p.name,
              type: p.type,
              dataUrl: p.dataUrl,
              jobId: null,
              status: "queued",
            })),
          );
          return;
        }
      } catch { /* fall through to single-file */ }
    }

    const raw = sessionStorage.getItem("glimpse:pending-upload");
    if (!raw) return;
    sessionStorage.removeItem("glimpse:pending-upload");
    try {
      const parsed = JSON.parse(raw) as { name: string; type: string; dataUrl: string };
      if (!parsed?.dataUrl) return;
      // Convert data URL → File
      fetch(parsed.dataUrl)
        .then((r) => r.blob())
        .then((blob) => {
          const f = new File([blob], parsed.name || "upload", { type: parsed.type || blob.type });
          // Synthesize a change event and reuse handleFileChange's logic.
          const dt = new DataTransfer();
          dt.items.add(f);
          const fakeEvt = { target: { files: dt.files } } as unknown as React.ChangeEvent<HTMLInputElement>;
          handleFileChange(fakeEvt);
        })
        .catch(() => { /* silently ignore — user can re-upload */ });
    } catch { /* malformed stash, ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track the uploaded job ID for AI analysis (set after upload, before enhance)
  const uploadedJobIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!currentJob) return;
    if (currentJob.status === "completed" && processStage !== "completed") {
      // The server-side /media/enhance-chain endpoint produces ONE completed
      // job for the full enhance → filter → upscale chain, so we no longer
      // need a client-side re-upload+upscale loop. (upscaleChainRef is kept
      // to silence ref-reset semantics elsewhere but is never set true now.)
      setProcessStage("completed");
      upscaleChainRef.current = false;
      const completionParts = [
        "Enhancement",
        selectedFilter ? "filter" : null,
        upscaleAfter ? "upscale" : null,
      ].filter(Boolean) as string[];
      const completionDesc = completionParts.length > 1
        ? `${completionParts.join(" + ")} applied!`
        : "Your media has been successfully enhanced.";
      toast({ title: "Enhancement complete!", description: completionDesc });

      // Save to local history (photos only, max 5).
      // Decode chain metadata if the server stored it in errorMessage so the
      // History row can show enhance + filter + upscale badges in one row.
      if (studioMode === "photo" && currentJob.processedUrl) {
        if (!currentJob.processedUrl.startsWith("data:image")) {
          console.warn("Received malformed processedUrl from backend:", currentJob.processedUrl);
        }
        let chainMeta: { servedBy?: "sidecar" | "native"; filterId?: string | null; upscale?: string | null } = {};
        try {
          const raw = (currentJob as { errorMessage?: string | null }).errorMessage;
          if (raw && raw.startsWith("{")) {
            const parsed = JSON.parse(raw) as {
              servedBy?: "sidecar" | "native";
              chain?: Array<{ stage: string; op: string }>;
            };
            const filterStage = parsed.chain?.find((s) => s.stage === "filter");
            const upscaleStage = parsed.chain?.find((s) => s.stage === "upscale");
            chainMeta = {
              servedBy: parsed.servedBy,
              filterId: filterStage?.op ?? null,
              upscale: upscaleStage?.op ?? null,
            };
          }
        } catch { /* not chain metadata, ignore */ }
        saveToHistory({
          filename: file?.name ?? "image.jpg",
          enhancementType: enhancementType ?? "auto_face",
          dataUri: currentJob.processedUrl,
          mimeType: file?.type ?? "image/jpeg",
          referenceCode: (currentJob as { referenceCode?: string | null }).referenceCode ?? undefined,
          filterId: chainMeta.filterId ?? selectedFilter ?? null,
          upscale: chainMeta.upscale ?? upscaleAfter ?? null,
          servedBy: chainMeta.servedBy,
        }).catch(() => {}); // silent fail — local storage only
      }
    } else if (currentJob.status === "failed" && processStage !== "failed") {
      setProcessStage("failed");
      upscaleChainRef.current = false;
      toast({ title: "Processing failed", description: currentJob.errorMessage ?? "Enhancement failed.", variant: "destructive" });
    } else if (currentJob.status === "processing" && processStage === "uploading") {
      setProcessStage("processing");
    }
  }, [currentJob?.status]);

  // Auto-analyze image after upload
  const runAnalysis = useCallback((jobId: number) => {
    setIsAnalyzing(true);
    analyzeMedia.mutate(
      { data: { jobId } },
      {
        onSuccess: (result) => {
          setAiSuggestion(result as AISuggestion);
          setIsAnalyzing(false);
          // Add AI message to chat panel
          const suggestion = result as AISuggestion;
          const msgId = ++chatIdRef.current;
          setChatMessages([{
            id: msgId,
            role: "ai",
            text: suggestion.description,
            action: {
              type: suggestion.suggestedEnhancement as EnhanceMediaBodyEnhancementType,
              filter: suggestion.suggestedFilter ?? undefined,
            },
          }]);
        },
        onError: () => {
          setIsAnalyzing(false);
        },
      },
    );
  }, [analyzeMedia]);

  const buildCanonicalEnhancementRequest = useCallback(() => {
    let effectiveType = enhancementType;
    const settings: Record<string, unknown> = {};
    const selectedPreset = selectedFilter ? FILTER_PRESETS_BY_KEY.get(selectedFilter) : undefined;
    const canonicalFilter = selectedFilter ? CANONICAL_FILTERS_BY_ID.get(selectedFilter) : undefined;

    if (selectedPreset?.serverFilter) {
      settings.filterId = selectedPreset.serverFilter;
      settings.filterVersion = canonicalFilter?.version ?? selectedPreset.version;
      // NOTE: Previously we downgraded effectiveType to "filter" for non-restoration
      // enhancements when a filter was selected. That made the chain spec drop the
      // enhance stage. The /media/enhance-chain endpoint runs enhance → filter →
      // upscale natively, so we keep the user's chosen enhancement intact and let
      // the chain orchestrator handle stacking. If no enhancement was chosen, the
      // chain is filter-only, which is also correct.
    }

    if (skinSmoothing !== 50) {
      settings.skinSmoothing = skinSmoothing;
    }

    if (mediaType === "video" && stabilize) {
      effectiveType = "stabilize" as EnhanceMediaBodyEnhancementType;
    }

    if (mediaType === "video") {
      if (videoSpeed !== 1.0) settings.speed = videoSpeed;
      if (trimStart > 0 || trimEnd < 100) {
        settings.trimStart = trimStart;
        settings.trimEnd = trimEnd;
      }
      if (muteAudio) settings.muteAudio = true;
      if (denoise) settings.denoise = true;
      if (videoColorGrade) settings.videoColorGrade = videoColorGrade;
      settings.restorationModel = "auto";
      // Video parity: forward selectedFilter + upscaleAfter so the sidecar
      // applies them on the restored frames (mapped color_grade or
      // per-frame approximation for unmapped filter ids).
      if (selectedFilter) settings.filterId = selectedFilter;
      if (upscaleAfter) settings.upscale = upscaleAfter;
    }

    if (mediaType === "photo") {
      if (transform.rotation !== 0) settings.rotation = transform.rotation;
      if (transform.flipH) settings.flipH = true;
      if (transform.flipV) settings.flipV = true;
      if (cropEnabled && !isDefaultCropBox(cropBox)) settings.crop = cropBox;

      if (filters.brightness !== 100) settings.brightness = filters.brightness;
      if (filters.contrast !== 100) settings.contrast = filters.contrast;
      if (filters.saturation !== 100) settings.saturation = filters.saturation;
      if (filters.sharpness !== 100) settings.sharpness = filters.sharpness;
      if (filters.warmth !== 0) settings.warmth = filters.warmth;
      if (filters.highlights !== 0) settings.highlights = 100 + filters.highlights;
      if (filters.shadows !== 0) settings.shadows = 100 + filters.shadows;
      if (filters.hue !== 0) settings.hue = filters.hue;
    }

    const hasPreviewableConfig =
      mediaType === "photo" &&
      (
        selectedFilter !== null ||
        (enhancementType !== "auto" && enhancementType !== "auto_face") ||
        skinSmoothing !== 50 ||
        transform.rotation !== 0 ||
        transform.flipH ||
        transform.flipV ||
        (cropEnabled && !isDefaultCropBox(cropBox)) ||
        filters.brightness !== 100 ||
        filters.contrast !== 100 ||
        filters.saturation !== 100 ||
        filters.sharpness !== 100 ||
        filters.warmth !== 0 ||
        filters.highlights !== 0 ||
        filters.shadows !== 0 ||
        filters.hue !== 0
      );

    return {
      effectiveType,
      settings: Object.keys(settings).length > 0 ? settings : undefined,
      hasPreviewableConfig,
    };
  }, [
    enhancementType,
    selectedFilter,
    skinSmoothing,
    mediaType,
    stabilize,
    videoSpeed,
    trimStart,
    trimEnd,
    muteAudio,
    denoise,
    videoColorGrade,
    transform,
    cropEnabled,
    cropBox,
    filters,
    editorMode,
    upscaleAfter,
  ]);

  useEffect(() => {
    const currentlyProcessing = processStage === "uploading" || processStage === "processing";
    const currentlyCompleted = processStage === "completed";

    if (!file || !base64Data || mediaType !== "photo" || currentlyProcessing || currentlyCompleted) {
      setIsRenderingPreview(false);
      return;
    }

    const { effectiveType, settings, hasPreviewableConfig } = buildCanonicalEnhancementRequest();
    if (!hasPreviewableConfig) {
      setCanonicalPreviewUrl(null);
      setIsRenderingPreview(false);
      return;
    }

    const requestSeq = ++previewRequestSeqRef.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsRenderingPreview(true);
      try {
        const token = localStorage.getItem("glimpse_token");
        const response = await fetch("/api/media/preview", {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            base64Data,
            mimeType: file.type,
            enhancementType: effectiveType,
            settings,
            previewMaxDimension: 1600,
          }),
        });

        if (!response.ok) {
          throw new Error(`Preview request failed (${response.status})`);
        }

        const payload = await response.json() as CanonicalPreviewResponse;
        if (previewRequestSeqRef.current !== requestSeq) return;
        setCanonicalPreviewUrl(`data:${payload.mimeType};base64,${payload.base64}`);
      } catch (err) {
        if (controller.signal.aborted) return;
        if (previewRequestSeqRef.current !== requestSeq) return;
        setCanonicalPreviewUrl(null);
        console.warn("Canonical preview render failed", err);
      } finally {
        if (previewRequestSeqRef.current === requestSeq) {
          setIsRenderingPreview(false);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    file,
    base64Data,
    mediaType,
    processStage,
    buildCanonicalEnhancementRequest,
  ]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sel = e.target.files?.[0];
    if (!sel) return;
    if (sel.size > MAX_FILE_MB * 1024 * 1024) {
      toast({ title: "File too large", description: `Max size is ${MAX_FILE_MB} MB. Please compress and retry.`, variant: "destructive" });
      return;
    }
    setFile(sel);
    setMediaType(sel.type.startsWith("video") ? "video" : "photo");
    setPreviewUrl(URL.createObjectURL(sel));
    setCanonicalPreviewUrl(null);
    setIsRenderingPreview(false);
    setCurrentJobId(null);
    setProcessStage("idle");
    setTransform(DEFAULT_TRANSFORM);
    setFilters(DEFAULT_FILTERS);
    setCropBox(DEFAULT_CROP);
    setCropEnabled(false);
    setStabilize(false);
    setDenoise(false);
    setSelectedFilter(null);
    setAiSuggestion(null);
    setSkinSmoothing(50);
    setUndoStack([]);
    setChatMessages([]);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const b64 = (ev.target?.result as string).split(",")[1];
      setBase64Data(b64);

      // Silent upload just for analysis (don't show progress)
      const isPhoto = !sel.type.startsWith("video");
      if (isPhoto) {
        uploadMedia.mutate(
          { data: { filename: sel.name, mimeType: sel.type, size: sel.size, mediaType: "photo", base64Data: b64 } },
          {
            onSuccess: (job) => {
              uploadedJobIdRef.current = job.id;
              runAnalysis(job.id);
            },
          },
        );
      }
    };
    reader.readAsDataURL(sel);
  };

  // Apply AI suggestion — IMMEDIATELY runs the enhancement (queues an
  // auto-process tick). The user no longer needs to click "Enhance Media"
  // after picking a suggestion. The actual fetch happens in the
  // pendingAutoProcessRef useEffect below, which runs after React has
  // committed the new enhancementType / selectedFilter state.
  const applyAiSuggestion = useCallback(() => {
    if (!aiSuggestion) return;
    const et = aiSuggestion.suggestedEnhancement as EnhanceMediaBodyEnhancementType;
    // Tier-lock guard: if the suggested enhancement (or its filter) is gated
    // for the user's plan, abort with an upgrade-friendly toast rather than
    // silently failing or sending a request the server will reject.
    if (isFeatureLocked(et)) {
      toast({
        title: `${tierLabel(et)} feature`,
        description: `Upgrade to ${tierLabel(et)} to apply ${getEnhancementMeta(et).label}.`,
        variant: "destructive",
      });
      return;
    }
    if (aiSuggestion.suggestedFilter && isFeatureLocked("filter", aiSuggestion.suggestedFilter)) {
      toast({
        title: "Premium filter",
        description: `Upgrade to apply the suggested filter.`,
        variant: "destructive",
      });
      return;
    }
    pushUndo();
    setEnhancementType(et);
    if (aiSuggestion.suggestedFilter) {
      const fp = FILTER_PRESETS.find((p) => p.key === aiSuggestion.suggestedFilter || p.serverFilter === aiSuggestion.suggestedFilter);
      if (fp) {
        setSelectedFilter(fp.key);
      }
    }
    // Mark last AI message as applied
    setChatMessages(prev => prev.map(m => m.role === "ai" ? { ...m, applied: true } : m));
    // Track
    trackAiEvent({
      ts: Date.now(), action: "applied",
      enhancement: et, filter: aiSuggestion.suggestedFilter ?? undefined,
      imageType: inferImageType(aiSuggestion.detectedSubjects),
      confidence: aiSuggestion.confidence,
    });
    toast({ title: `Applying ${getEnhancementMeta(et).label}`, description: "Running enhancement now…" });
    pendingAutoProcessRef.current = { source: "ai-suggestion" };
    setAutoProcessTick(t => t + 1);
    // isFeatureLocked / tierLabel are stable identity checks against role+plan,
    // and recomputed on render — they don't need to be in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiSuggestion, pushUndo, toast]);

  // Apply a specific alternative enhancement — also auto-runs immediately.
  const applyAlternative = useCallback((et: EnhanceMediaBodyEnhancementType) => {
    // Tier-lock guard — keep parity with applyAiSuggestion so locked alts
    // surface a friendly upgrade prompt instead of silently failing.
    if (isFeatureLocked(et)) {
      toast({
        title: `${tierLabel(et)} feature`,
        description: `Upgrade to ${tierLabel(et)} to apply ${getEnhancementMeta(et).label}.`,
        variant: "destructive",
      });
      return;
    }
    pushUndo();
    setEnhancementType(et);
    if (aiSuggestion) {
      trackAiEvent({
        ts: Date.now(), action: "applied",
        enhancement: et,
        imageType: inferImageType(aiSuggestion.detectedSubjects),
        confidence: aiSuggestion.confidence,
      });
    }
    toast({ title: `Applying ${getEnhancementMeta(et).label}`, description: "Running enhancement now…" });
    pendingAutoProcessRef.current = { source: "alternative" };
    setAutoProcessTick(t => t + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiSuggestion, pushUndo, toast]);

  // Export handler — extracted for reuse by button + keyboard shortcut
  const handleExport = useCallback(() => {
    if (processStage !== "completed" || !currentJob?.processedUrl) return;
    pendingExportRef.current = false;
    try {
      const dataUri = currentJob.processedUrl;
      const byteString = atob(dataUri.split(",")[1] ?? dataUri);
      const mimeMatch = dataUri.match(/^data:([^;]+);/);
      const mime = mimeMatch?.[1] ?? "image/jpeg";
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
      const blob = new Blob([ab], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ref = (currentJob as { referenceCode?: string | null }).referenceCode;
      a.download = buildEnhancedDownloadName({
        originalFilename: file?.name ?? (studioMode === "video" ? "video.mp4" : "image.jpg"),
        enhancementType: enhancementType ?? (studioMode === "video" ? "trim" : "auto_face"),
        referenceCode: ref,
        mime,
      });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ title: "Download started", description: "Your enhanced image is being saved." });
    } catch {
      window.open(currentJob.processedUrl!, "_blank");
      toast({ title: "Download", description: "Image opened in a new tab. Right-click to save." });
    }
  }, [processStage, currentJob, file?.name, enhancementType, studioMode, toast]);

  const handleProcess = useCallback(async () => {
    if (!file || !base64Data) return;
    const { effectiveType, settings } = buildCanonicalEnhancementRequest();

    setProcessStage("uploading");
    uploadMedia.mutate(
      { data: { filename: file.name, mimeType: file.type, size: file.size, mediaType, base64Data } },
      {
        onSuccess: async (job) => {
          setCurrentJobId(job.id);
          setProcessStage("processing");

          // ── Decide: chain or single? ───────────────────────────────────
          // If the user picked a filter or an upscale step (or both) in
          // Photo Studio, we run the full enhance → filter → upscale chain
          // server-side via /media/enhance-chain (returns ONE final job).
          // Video and single-step calls keep using the legacy /media/enhance.
          const wantsChain =
            mediaType === "photo" &&
            (selectedFilter !== null || upscaleAfter !== null);

          if (wantsChain) {
            try {
              const token = localStorage.getItem("glimpse_token");
              const chainBody = {
                jobId: job.id,
                enhance: effectiveType === "filter" ? null : effectiveType,
                filterId: selectedFilter ?? null,
                upscale: upscaleAfter ?? null,
                settings,
              };
              const resp = await fetch("/api/media/enhance-chain", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify(chainBody),
              });
              if (!resp.ok) {
                const errBody = await resp.json().catch(() => ({})) as { error?: string };
                throw new Error(errBody.error ?? `Chain request failed (${resp.status})`);
              }
              // Server starts processing; useGetMediaJob polling will pick up
              // status updates exactly like the single-step path.
            } catch (err) {
              const message = err instanceof Error ? err.message : "Failed to start chain.";
              setProcessStage("failed");
              toast({ title: "Enhancement failed", description: message, variant: "destructive" });
            }
            return;
          }

          enhanceMedia.mutate(
            { data: { jobId: job.id, enhancementType: effectiveType, presetId, settings } },
            {
              onError: (err: any) => {
                setProcessStage("failed");
                toast({ title: "Enhancement failed", description: err?.data?.error ?? err?.message ?? "Failed to start enhancement.", variant: "destructive" });
              },
            },
          );
        },
        onError: (err: any) => {
          setProcessStage("failed");
          const status = err?.status as number | undefined;
          if (status === 413) {
            toast({ title: "Upload failed", description: "File too large. Try a smaller file (max 100 MB).", variant: "destructive" });
            return;
          }
          if (status === 401) {
            toast({ title: "Upload failed", description: "Session expired. Please log in again.", variant: "destructive" });
            return;
          }
          if (status === 403) {
            // Distinguish trial / monthly / daily / tier so the user knows
            // exactly whether to wait, top up with a credit pack, or upgrade.
            const friendly = describeQuotaError({
              code: err?.data?.code,
              quotaType: err?.data?.quotaType,
              message: err?.data?.error,
            });
            toast({
              title: friendly.title,
              description: friendly.description,
              variant: "destructive",
              action: (
                <ToastAction
                  altText={friendly.ctaLabel}
                  onClick={() => { window.location.href = friendly.ctaHref; }}
                >
                  {friendly.ctaLabel}
                </ToastAction>
              ),
            });
            return;
          }
          const desc = err?.data?.error ?? err?.message ?? "Failed to upload file.";
          toast({ title: "Upload failed", description: desc, variant: "destructive" });
        },
      },
    );
  }, [file, base64Data, mediaType, presetId, buildCanonicalEnhancementRequest, toast, selectedFilter, upscaleAfter, enhanceMedia, uploadMedia]);

  // Auto-process effect: when applyAiSuggestion / applyAlternative / a filter
  // chip queues a tick, run handleProcess() with the latest state. The ref
  // gate (`pendingAutoProcessRef.current`) ensures we ONLY fire when an
  // action handler explicitly requested a run — not on every render. We pull
  // dependencies legitimately so handleProcess always has the freshest state.
  useEffect(() => {
    if (!pendingAutoProcessRef.current) return;
    if (!file || !base64Data) return;
    const isProcessingNow = processStage === "uploading" || processStage === "processing";
    if (isProcessingNow) return;
    const reason = pendingAutoProcessRef.current.source;
    pendingAutoProcessRef.current = null;
    void reason;
    void handleProcess();
  }, [autoProcessTick, file, base64Data, processStage, handleProcess, enhancementType, selectedFilter, upscaleAfter]);

  // Process & Export — for staged state: trigger processing then auto-download
  const handleProcessAndExport = useCallback(() => {
    pendingExportRef.current = true;
    void handleProcess();
  }, [handleProcess]);

  /**
   * Process all queued batch items.
   *
   * Flow:
   *   1) For each item, upload via /media/upload and capture jobId.
   *   2) Once every jobId is known, call /media/enhance-batch with the
   *      shared (enhance / filter / upscale) settings. The server enforces
   *      tier-aware maxBatchJobsForPlan; the UI surfaces failure clearly.
   *   3) Per-file status flips queued → uploading → processing → completed.
   *
   * Uses the same buildCanonicalEnhancementRequest() as single-file mode so
   * the chain spec (filterId / videoColorGrade / etc.) matches.
   */
  const handleBatchProcess = useCallback(async () => {
    if (batchItems.length === 0) return;
    if (isBatchProcessing) return;
    setIsBatchProcessing(true);

    const { effectiveType, settings } = buildCanonicalEnhancementRequest();
    const token = localStorage.getItem("glimpse_token");
    const authHeader: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    // 1. Upload each file sequentially (sessionStorage and server upload are
    //    both rate-limited; serial keeps memory usage predictable).
    const updatedItems = [...batchItems];
    for (let i = 0; i < updatedItems.length; i++) {
      const item = updatedItems[i];
      if (item.jobId) continue;
      updatedItems[i] = { ...item, status: "uploading" };
      setBatchItems([...updatedItems]);
      try {
        const blob = await fetch(item.dataUrl).then((r) => r.blob());
        const base64 = item.dataUrl.split(",")[1] ?? "";
        const isVideo = (item.type || "").startsWith("video/");
        const uploadResp = await fetch("/api/media/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({
            filename: item.name,
            mimeType: item.type || (isVideo ? "video/mp4" : "image/jpeg"),
            size: blob.size,
            mediaType: isVideo ? "video" : "photo",
            base64Data: base64,
          }),
        });
        if (!uploadResp.ok) {
          const err = await uploadResp.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error ?? `Upload failed (${uploadResp.status})`);
        }
        const job = await uploadResp.json() as { id: number };
        updatedItems[i] = { ...updatedItems[i], jobId: job.id, status: "processing" };
        setBatchItems([...updatedItems]);
      } catch (err) {
        updatedItems[i] = {
          ...updatedItems[i],
          status: "failed",
          error: err instanceof Error ? err.message : "Upload failed",
        };
        setBatchItems([...updatedItems]);
      }
    }

    // 2. Send the full jobId list to /media/enhance-batch in one call.
    const ids = updatedItems.filter((it) => it.jobId !== null).map((it) => it.jobId as number);
    if (ids.length === 0) {
      setIsBatchProcessing(false);
      toast({ title: "Batch failed", description: "No files were uploaded successfully.", variant: "destructive" });
      return;
    }
    try {
      const resp = await fetch("/api/media/enhance-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ jobIds: ids, enhancementType: effectiveType, settings }),
      });
      if (!resp.ok) {
        // Differentiate quota / tier / batch-limit codes so the user gets
        // an actionable next step (upgrade vs top up vs retry tomorrow)
        // instead of an opaque "batch failed".
        const errBody = (await resp.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
          quotaType?: string;
        };
        const friendly = describeQuotaError({
          code: errBody.code,
          quotaType: errBody.quotaType,
          message: errBody.error,
        });
        toast({
          title: friendly.title,
          description: friendly.description,
          variant: "destructive",
          action: (
            <ToastAction
              altText={friendly.ctaLabel}
              onClick={() => { window.location.href = friendly.ctaHref; }}
            >
              {friendly.ctaLabel}
            </ToastAction>
          ),
        });
        setBatchItems((prev) =>
          prev.map((it) => (it.status === "processing" ? { ...it, status: "failed", error: friendly.title } : it)),
        );
        setIsBatchProcessing(false);
        return;
      }
      toast({
        title: `Batch started: ${ids.length} files`,
        description: "Each file's progress is shown in the queue. View results in History when complete.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Batch failed";
      toast({ title: "Batch failed", description: message, variant: "destructive" });
      setBatchItems((prev) =>
        prev.map((it) => (it.status === "processing" ? { ...it, status: "failed", error: message } : it)),
      );
    }
    setIsBatchProcessing(false);
  }, [batchItems, isBatchProcessing, buildCanonicalEnhancementRequest, toast]);

  /** Remove a single file from the batch queue (only when not yet uploading). */
  const removeBatchItem = useCallback((id: string) => {
    setBatchItems((prev) =>
      prev.filter((it) => !(it.id === id && it.status === "queued")),
    );
  }, []);

  // ── Batch "Download All" ──────────────────────────────────────────────────
  // Once batch jobs finish, users want to grab every enhanced result without
  // clicking through History one-by-one. We zip the completed entries
  // client-side (STORE method, see lib/zip-store.ts) and trigger a single
  // browser download. Failed/in-flight items are skipped silently; the toast
  // surfaces the actual count of files included.
  const [isDownloadingBatch, setIsDownloadingBatch] = useState(false);
  const completedBatchCount = useMemo(
    () => batchItems.filter((it) => it.status === "completed" && it.jobId !== null).length,
    [batchItems],
  );

  const handleBatchDownloadAll = useCallback(async () => {
    if (isDownloadingBatch) return;
    const completed = batchItems.filter(
      (it) => it.status === "completed" && it.jobId !== null,
    );
    if (completed.length === 0) {
      toast({
        title: "Nothing to download yet",
        description: "Wait for at least one file to finish processing.",
      });
      return;
    }

    setIsDownloadingBatch(true);
    const token = localStorage.getItem("glimpse_token");
    const authHeader: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    try {
      const entries: ZipEntry[] = [];
      const seenNames = new Set<string>();
      let skippedNoData = 0;

      for (const it of completed) {
        try {
          const r = await fetch(`/api/media/jobs/${it.jobId}`, { headers: authHeader });
          if (!r.ok) {
            skippedNoData++;
            continue;
          }
          const job = (await r.json()) as {
            processedUrl?: string | null;
            referenceCode?: string | null;
            enhancementType?: string | null;
          };
          if (!job.processedUrl) {
            skippedNoData++;
            continue;
          }
          const dataUri = job.processedUrl;
          const mimeMatch = dataUri.match(/^data:([^;]+);/);
          const mime = mimeMatch?.[1] ?? (it.type || "image/jpeg");
          const bytes = base64ToBytes(dataUri);

          let name = buildEnhancedDownloadName({
            originalFilename: it.name,
            enhancementType: job.enhancementType ?? enhancementType ?? "auto",
            referenceCode: job.referenceCode ?? null,
            mime,
          });
          if (seenNames.has(name)) {
            const dot = name.lastIndexOf(".");
            const stem = dot > 0 ? name.slice(0, dot) : name;
            const ext = dot > 0 ? name.slice(dot) : "";
            let n = 2;
            while (seenNames.has(`${stem}-${n}${ext}`)) n++;
            name = `${stem}-${n}${ext}`;
          }
          seenNames.add(name);
          entries.push({ name, data: bytes });
        } catch {
          skippedNoData++;
        }
      }

      if (entries.length === 0) {
        toast({
          title: "Download unavailable",
          description:
            "No completed batch results have downloadable data yet. Try again in a moment, or open History to grab them individually.",
          variant: "destructive",
        });
        return;
      }

      const blob = buildStoreZip(entries);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "")
        .replace("T", "-")
        .slice(0, 15);
      a.download = `glimpse-batch-${stamp}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);

      const detail =
        skippedNoData > 0
          ? `${entries.length} file${entries.length === 1 ? "" : "s"} zipped (${skippedNoData} skipped — not yet ready).`
          : `${entries.length} file${entries.length === 1 ? "" : "s"} zipped and saved to your Downloads folder.`;
      toast({ title: "Batch download started", description: detail });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Download failed";
      toast({ title: "Download failed", description: message, variant: "destructive" });
    } finally {
      setIsDownloadingBatch(false);
    }
  }, [batchItems, isDownloadingBatch, enhancementType, toast]);

  /**
   * Poll status for in-flight batch jobs every 2.5s. Stops once all items
   * are in a terminal state (completed/failed). The /api/media/jobs/:id
   * endpoint is the same one the History page uses, so we get parity with
   * single-file enhancement progress.
   */
  useEffect(() => {
    const inflight = batchItems.filter(
      (it) => it.jobId !== null && (it.status === "processing" || it.status === "uploading"),
    );
    if (inflight.length === 0) return;

    const token = localStorage.getItem("glimpse_token");
    const authHeader: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    let cancelled = false;

    const tick = async () => {
      const updates = await Promise.all(
        inflight.map(async (it) => {
          try {
            const r = await fetch(`/api/media/jobs/${it.jobId}`, { headers: authHeader });
            if (!r.ok) return null;
            const j = await r.json() as { status?: string; errorMessage?: string };
            return { id: it.id, status: j.status, error: j.errorMessage };
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      setBatchItems((prev) =>
        prev.map((it) => {
          const u = updates.find((x) => x?.id === it.id);
          if (!u || !u.status) return it;
          if (u.status === "completed") return { ...it, status: "completed" };
          if (u.status === "failed") return { ...it, status: "failed", error: u.error ?? "Failed" };
          return it;
        }),
      );
    };

    const interval = window.setInterval(tick, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [batchItems]);

  // ── Contextual post-enhance Upscale toast ──────────────────────────────
  //    When a non-upscale enhancement completes, invite the user to upscale
  //    the result in one click (sets enhancementType and lets them "Enhance
  //    Again"). Shown once per completion, not for upscale runs themselves.
  const lastCompletedJobRef = useRef<number | null>(null);
  useEffect(() => {
    if (processStage !== "completed") return;
    if (!currentJob || !currentJob.processedUrl) return;
    if (lastCompletedJobRef.current === currentJob.id) return;
    lastCompletedJobRef.current = currentJob.id;
    const isUpscaleRun =
      enhancementType === "upscale" ||
      enhancementType === "upscale_4x" ||
      enhancementType === "esrgan_upscale_2x" ||
      enhancementType === "esrgan_upscale_4x";
    if (isUpscaleRun) return;
    if (studioMode !== "photo") return;
    toast({
      title: "✨ Enhanced! Want it sharper?",
      description: "Upscale your result up to 4× with AI detail recovery.",
      action: (
        <ToastAction
          altText="Upscale 2×"
          onClick={() => {
            setEnhancementType("upscale");
            toast({
              title: "Upscale 2× selected",
              description: "Click 'Enhance Again' to apply.",
            });
          }}
        >
          Upscale 2×
        </ToastAction>
      ),
    });
  }, [processStage, currentJob, enhancementType, studioMode, toast]);

  // Auto-download when processing completes after Process & Export was clicked
  useEffect(() => {
    if (processStage === "completed" && pendingExportRef.current) {
      handleExport();
    }
  }, [processStage, handleExport]);

  // Keyboard shortcut: Cmd+S / Ctrl+S to export (or trigger Process & Export if staged)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (processStage === "completed") {
          handleExport();
        } else if (file) {
          handleProcessAndExport();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleExport, handleProcessAndExport, processStage, file]);

  const resetAll = () => {
    setFile(null); setPreviewUrl(""); setBase64Data(""); setCanonicalPreviewUrl(null); setIsRenderingPreview(false);
    setCurrentJobId(null); setProcessStage("idle"); setZoomLevel(1); setPanOffset({ x: 0, y: 0 });
    setTransform(DEFAULT_TRANSFORM); setFilters(DEFAULT_FILTERS);
    setCropBox(DEFAULT_CROP); setCropEnabled(false);
    setStabilize(false); setDenoise(false);
    setVideoSpeed(1.0); setTrimStart(0); setTrimEnd(100); setMuteAudio(false); setVideoColorGrade(null);
    setSelectedFilter(null); setAiSuggestion(null);
    setSkinSmoothing(50); uploadedJobIdRef.current = null;
    setUndoStack([]); setChatMessages([]); setShowAiChat(false);
    setUpscaleAfter(null); upscaleChainRef.current = false;
  };

  // Reset just the batch session — keeps the editor open (no page reload),
  // clears every queued/processed item, drops batch-only UI state, and
  // returns the user straight to the upload prompt with the side panel
  // settings reverted to safe defaults so the next batch starts clean.
  const resetBatchSession = useCallback(() => {
    setBatchItems([]);
    setBatchPreviewIndex(0);
    setSelectedFilter(null);
    setEnhancementType("auto_face");
    setUpscaleAfter(null);
    upscaleChainRef.current = false;
    setIsBatchProcessing(false);
    toast({ title: "Batch reset", description: "Drop or pick new files to start another batch." });
  }, [batchItems.length, enhancementType, selectedFilter, upscaleAfter, toast]);

  const isProcessing = processStage === "uploading" || processStage === "processing";
  const isCompleted = processStage === "completed";
  const hasEdits = transform.rotation !== 0 || transform.flipH || transform.flipV
    || filters.brightness !== 100 || filters.contrast !== 100 || filters.saturation !== 100 || filters.sharpness !== 100
    || filters.warmth !== 0 || filters.highlights !== 0 || filters.shadows !== 0 || filters.hue !== 0
    || (cropEnabled && (cropBox.x !== 0 || cropBox.y !== 0 || cropBox.x2 !== 100 || cropBox.y2 !== 100));

  const activePresetCssExtra = selectedFilter ? FILTER_PRESETS_BY_KEY.get(selectedFilter)?.cssExtra : undefined;
  const previewFallbackFilters = mergePreviewFilterState(filters, selectedFilter);
  const previewStyle = buildPreviewStyle(transform, previewFallbackFilters, cropEnabled ? cropBox : DEFAULT_CROP, activePresetCssExtra);
  const livePreviewSrc = canonicalPreviewUrl ?? previewUrl;
  const stageInfo = STAGE_INFO[processStage];

  // ── Batch preview helpers ─────────────────────────────────────────────────
  // We only render image items in the live CSS preview (videos need their own
  // playback layer — they fall through to the queue strip but aren't shown as
  // the "sample"). The activeBatchPreview flag is what every render branch
  // below uses to decide between (a) the standalone empty Batch Studio card,
  // (b) the integrated Studio-with-queue layout, or (c) the normal single-
  // file flow.
  const imageBatchItems = useMemo(
    () => batchItems.filter((it) => (it.type || "").startsWith("image/")),
    [batchItems],
  );
  const safeBatchPreviewIndex =
    imageBatchItems.length === 0
      ? 0
      : Math.min(batchPreviewIndex, imageBatchItems.length - 1);
  const batchPreviewItem = imageBatchItems[safeBatchPreviewIndex] ?? null;
  // True when we're in the integrated batch view: batch mode active OR the
  // user has at least one queued image, AND no single-file is loaded (single-
  // file view always wins to avoid cross-contamination of state).
  const showBatchPreview = !file && batchPreviewItem !== null;
  // Any active batch session (with items, regardless of preview availability)
  // — used to swap the bottom action button to "Process Batch (N)".
  const isBatchActive = (isBatchMode || batchItems.length > 0) && batchItems.length > 0;
  const batchProcessableCount = batchItems.filter(
    (it) => it.status === "queued" || it.status === "failed",
  ).length;

  // Keep the preview index inside the photo subset when items are added or
  // removed. Resetting to 0 mirrors the "first image" default the user sees
  // on first entry; it never silently jumps to a different photo while the
  // user is interacting with one (we only correct out-of-bounds).
  useEffect(() => {
    if (imageBatchItems.length === 0) {
      if (batchPreviewIndex !== 0) setBatchPreviewIndex(0);
      return;
    }
    if (batchPreviewIndex >= imageBatchItems.length) {
      setBatchPreviewIndex(imageBatchItems.length - 1);
    }
  }, [imageBatchItems.length, batchPreviewIndex]);

  const visibleFilters = showAllFilters ? FILTER_PRESETS : FILTER_PRESETS.slice(0, 12);

  const PHOTO_ENHANCEMENT_TYPES: { type: EnhanceMediaBodyEnhancementType; label: string; icon: React.ReactNode }[] = [
    { type: "auto",                   label: "Auto",        icon: <Wand2       className="w-3 h-3" /> },
    { type: "upscale",                label: "2x Up",       icon: <ZoomIn      className="w-3 h-3" /> },
    { type: "upscale_4x",             label: "4x Up",       icon: <Layers      className="w-3 h-3" /> },
    { type: "portrait",               label: "Portrait",    icon: <Sparkles    className="w-3 h-3" /> },
    { type: "color",                  label: "Color",       icon: <Palette     className="w-3 h-3" /> },
    { type: "lighting_enhance",       label: "Lighting",    icon: <Sun         className="w-3 h-3" /> },
    { type: "beauty",                 label: "Beauty",      icon: <Eye         className="w-3 h-3" /> },
    { type: "blur_background",        label: "Bg Blur",     icon: <Focus       className="w-3 h-3" /> },
    { type: "skin_retouch",           label: "Retouch",     icon: <Paintbrush  className="w-3 h-3" /> },
    { type: "color_grade_cinematic",  label: "Cinematic",   icon: <Film        className="w-3 h-3" /> },
    { type: "color_grade_warm",       label: "Warm",        icon: <Thermometer className="w-3 h-3" /> },
    { type: "color_grade_cool",       label: "Cool",        icon: <Droplets    className="w-3 h-3" /> },
    { type: "filter",                 label: "Filter",      icon: <Camera      className="w-3 h-3" /> },
    { type: "background",             label: "Background",  icon: <Mountain    className="w-3 h-3" /> },
    { type: "face_restore",            label: "Face AI",     icon: <ScanFace    className="w-3 h-3" /> },
    { type: "codeformer",              label: "CodeFmr",     icon: <ScanEye     className="w-3 h-3" /> },
    { type: "hybrid",                  label: "Hybrid",      icon: <Sparkles    className="w-3 h-3" /> },
    { type: "auto_face",               label: "Auto Face",   icon: <Sparkles    className="w-3 h-3" /> },
    { type: "old_photo_restore",       label: "Old Photo",   icon: <ImageUp     className="w-3 h-3" /> },
    { type: "esrgan_upscale_2x",       label: "SR 2×",       icon: <ZoomIn      className="w-3 h-3" /> },
    { type: "esrgan_upscale_4x",       label: "SR 4×",       icon: <Layers      className="w-3 h-3" /> },
  ];

  const ENHANCEMENT_TYPES: { type: EnhanceMediaBodyEnhancementType; label: string; icon: React.ReactNode }[] =
    mediaType === "video"
      ? [
          { type: "video_restore", label: "AI Enhance", icon: <Film className="w-3 h-3" /> },
          { type: "stabilize", label: "Stabilize", icon: <Camera className="w-3 h-3" /> },
          { type: "trim", label: "Trim polish", icon: <Scissors className="w-3 h-3" /> },
        ]
      : PHOTO_ENHANCEMENT_TYPES;

  return (
    <Layout>
      <TooltipProvider delayDuration={200}>
        {showOnboarding && <OnboardingWalkthrough onComplete={completeOnboarding} />}

        <div className="flex flex-col lg:flex-row h-[calc(100vh-4rem)] overflow-hidden">

          {/* Sidebar */}
          <aside className="w-full lg:w-80 xl:w-[22rem] border-r border-white/10 bg-zinc-950 flex flex-col shrink-0 z-20 lg:max-h-full lg:h-full overflow-hidden">
            <div className="p-3 border-b border-white/10">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold text-base flex items-center gap-2">
                  <Settings2 className="w-4 h-4 text-teal-500" />
                  {studioMode === "video" ? "Video Studio" : "Photo Studio"}
                </h2>
                <button onClick={() => setShowOnboarding(true)} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors" title="Show walkthrough">?</button>
              </div>
              {/* Mode toggle — hidden in Video Studio (always advanced) */}
              {studioMode !== "video" && (
              <div className="flex bg-zinc-900 rounded-lg p-0.5">
                <button className={cn("flex-1 text-xs font-medium py-1.5 px-3 rounded-md transition-all", editorMode === "simple" ? "bg-teal-600 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-300")} onClick={() => setEditorMode("simple")}>
                  <Zap className="w-3 h-3 inline mr-1" />Simple
                </button>
                <button className={cn("flex-1 text-xs font-medium py-1.5 px-3 rounded-md transition-all", editorMode === "advanced" ? "bg-teal-600 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-300")} onClick={() => setEditorMode("advanced")}>
                  <SlidersHorizontal className="w-3 h-3 inline mr-1" />Advanced
                </button>
              </div>
              )}
            </div>

            <ScrollArea className="flex-1">
              <div className="p-3">

                {/* AI Suggestion Banner — visible to ALL users.
                    Friendly labels are used everywhere (e.g. "Auto Face" instead
                    of "auto_face"). Internal routing badges ("Premium model" /
                    "Native fallback") are admin-only because they expose
                    serving-layer detail. Tier-locked alternatives show a lock
                    icon + the gating tier ("🔒 Premium — Upgrade to unlock")
                    so users always see WHY a recommendation isn't available. */}
                <AnimatePresence>
                  {file && (isAnalyzing || aiSuggestion) && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mb-4 overflow-hidden max-w-full"
                    >
                      {isAnalyzing ? (
                        <div className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-3 flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-teal-500/10 flex items-center justify-center shrink-0">
                            <Loader2 className="w-4 h-4 text-teal-400 animate-spin" />
                          </div>
                          <div>
                            <p className="text-xs font-medium text-teal-300">AI is analyzing your image...</p>
                            <p className="text-[10px] text-teal-400/60">Finding the best enhancement</p>
                          </div>
                        </div>
                      ) : aiSuggestion && (() => {
                        // Resolve friendly labels for both the enhancement and (optional)
                        // filter so the panel never leaks raw type keys like "auto_face".
                        const suggestedType = aiSuggestion.suggestedEnhancement as EnhanceMediaBodyEnhancementType;
                        const friendlyEnhancement = getEnhancementMeta(suggestedType).label;
                        const suggestedFilterPreset = aiSuggestion.suggestedFilter
                          ? FILTER_PRESETS.find((p) => p.key === aiSuggestion.suggestedFilter || p.serverFilter === aiSuggestion.suggestedFilter)
                          : null;
                        const friendlyFilter = suggestedFilterPreset?.name ?? aiSuggestion.suggestedFilter ?? null;
                        // Tier-lock check: when the suggested enhancement (or its filter)
                        // is gated for the user's plan, the Apply button degrades to an
                        // "Upgrade" CTA so users always see WHY a recommendation isn't
                        // available rather than an unresponsive button.
                        const enhancementLocked = isFeatureLocked(suggestedType);
                        const filterLocked = aiSuggestion.suggestedFilter
                          ? isFeatureLocked("filter", aiSuggestion.suggestedFilter)
                          : false;
                        const anyLocked = enhancementLocked || filterLocked;
                        const lockReason = enhancementLocked
                          ? `${tierLabel(suggestedType)} feature`
                          : filterLocked
                            ? "Premium filter"
                            : "";
                        return (
                        <div className="rounded-xl border border-teal-500/30 bg-gradient-to-r from-teal-500/10 to-cyan-500/10 p-3">
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-full bg-teal-500/20 flex items-center justify-center shrink-0 mt-0.5">
                              <ScanEye className="w-4 h-4 text-teal-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <p className="text-xs font-semibold text-teal-200 tracking-wide">AI Recommendation</p>
                                <Badge variant="outline" className="text-[9px] border-teal-500/40 text-teal-300 px-1.5 py-0 h-4 capitalize">
                                  {inferImageType(aiSuggestion.detectedSubjects)}
                                </Badge>
                                {/* Internal serving-layer badges are admin-only — they
                                    expose model routing detail (sidecar vs native) that
                                    isn't meaningful to end users. */}
                                {isAdmin && aiSuggestion.servedBy === "sidecar" && (
                                  <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-300 px-1.5 py-0 h-4">
                                    Premium model
                                  </Badge>
                                )}
                                {isAdmin && aiSuggestion.servedBy === "native" && aiSuggestion.suggestedEnhancement === "auto_face" && (
                                  <Badge variant="outline" className="text-[9px] border-amber-500/40 text-amber-300 px-1.5 py-0 h-4">
                                    Native fallback
                                  </Badge>
                                )}
                                {anyLocked && (
                                  <Badge variant="outline" className="text-[9px] border-amber-500/40 text-amber-300 px-1.5 py-0 h-4 inline-flex items-center gap-1">
                                    <Lock className="w-2.5 h-2.5" />
                                    {lockReason}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-zinc-300 leading-relaxed mb-2">{aiSuggestion.description}</p>
                              <div className="flex flex-wrap gap-1 mb-2">
                                {aiSuggestion.detectedSubjects.slice(0, 4).map((s) => (
                                  <Badge key={s} variant="outline" className="text-[9px] border-teal-500/30 text-teal-300 px-1.5 py-0 h-4">{s}</Badge>
                                ))}
                              </div>
                              {anyLocked ? (
                                <div className="space-y-1.5">
                                  <Button
                                    size="sm"
                                    className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white font-medium whitespace-normal"
                                    onClick={() => toast({
                                      title: `${lockReason} required`,
                                      description: `Upgrade your plan to apply ${friendlyEnhancement}${friendlyFilter ? ` + ${friendlyFilter}` : ""}.`,
                                      variant: "destructive",
                                    })}
                                  >
                                    <Lock className="w-3.5 h-3.5 mr-1.5" />
                                    Upgrade to apply {friendlyEnhancement}
                                  </Button>
                                  <p className="text-[10px] text-zinc-500 leading-snug">
                                    This recommendation requires your plan to include {lockReason.toLowerCase()}. Pick an unlocked alternative below or upgrade in <span className="text-amber-300">Billing</span>.
                                  </p>
                                </div>
                              ) : (
                                <Button size="sm" className="h-7 text-xs bg-teal-600 hover:bg-teal-700 text-white font-medium whitespace-normal" onClick={applyAiSuggestion}>
                                  <Sparkles className="w-4 h-4 mr-1.5" />
                                  Apply: {friendlyEnhancement}
                                  {friendlyFilter && ` + ${friendlyFilter}`}
                                </Button>
                              )}
                              {/* Alternative suggestions based on image type — locked
                                  alternatives display a lock icon + tier badge so users
                                  always see WHY the option isn't selectable. */}
                              {(() => {
                                const alts = getAlternatives(
                                  inferImageType(aiSuggestion.detectedSubjects),
                                  aiSuggestion.suggestedEnhancement,
                                );
                                if (alts.length === 0) return null;
                                return (
                                  <div className="mt-2 pt-2 border-t border-white/5">
                                    <p className="text-[10px] text-zinc-500 mb-1.5">Or try:</p>
                                    <div className="flex flex-wrap gap-1">
                                      {alts.map(a => {
                                        const altLocked = isFeatureLocked(a.type);
                                        const altTier = altLocked ? tierLabel(a.type) : "";
                                        return (
                                          <Tooltip key={a.type}>
                                            <TooltipTrigger asChild>
                                              <button
                                                onClick={() => {
                                                  if (altLocked) {
                                                    toast({
                                                      title: `${altTier} feature`,
                                                      description: `Upgrade to ${altTier} to apply ${getEnhancementMeta(a.type).label}.`,
                                                      variant: "destructive",
                                                    });
                                                    return;
                                                  }
                                                  applyAlternative(a.type);
                                                }}
                                                className={cn(
                                                  "text-[10px] px-2.5 py-1 rounded-full border transition-colors inline-flex items-center gap-1",
                                                  altLocked
                                                    ? "border-amber-500/40 text-amber-300/90 hover:border-amber-400 cursor-pointer"
                                                    : "border-zinc-700 text-zinc-400 hover:border-teal-500 hover:text-teal-300",
                                                )}
                                                aria-label={altLocked ? `${a.label} — locked, upgrade to ${altTier}` : `Apply ${a.label}`}
                                              >
                                                {altLocked && <Lock className="w-2.5 h-2.5" />}
                                                {a.label}
                                                {altLocked && (
                                                  <span className="ml-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300/80">
                                                    {altTier}
                                                  </span>
                                                )}
                                              </button>
                                            </TooltipTrigger>
                                            {altLocked && (
                                              <TooltipContent side="bottom" className="text-xs max-w-[220px]">
                                                Locked — upgrade to {altTier} to use {getEnhancementMeta(a.type).label}.
                                              </TooltipContent>
                                            )}
                                          </Tooltip>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                          {/* Confidence + Dismiss row */}
                          <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center gap-2 cursor-help">
                                  <div className={cn(
                                    "w-2 h-2 rounded-full",
                                    aiSuggestion.confidence >= 0.85 ? "bg-emerald-400" : aiSuggestion.confidence >= 0.6 ? "bg-amber-400" : "bg-red-400"
                                  )} />
                                  <span className={cn(
                                    "text-xs font-medium",
                                    aiSuggestion.confidence >= 0.85 ? "text-emerald-400" : aiSuggestion.confidence >= 0.6 ? "text-amber-400" : "text-red-400"
                                  )}>
                                    {Math.round(aiSuggestion.confidence * 100)}% confidence
                                  </span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="text-xs max-w-[200px]">
                                {aiSuggestion.confidence >= 0.85
                                  ? "High confidence — AI is very sure this enhancement will look great"
                                  : aiSuggestion.confidence >= 0.6
                                    ? "Medium confidence — this enhancement should produce good results"
                                    : "Low confidence — you might want to try alternatives for better results"}
                              </TooltipContent>
                            </Tooltip>
                            <button
                              onClick={() => {
                                trackAiEvent({
                                  ts: Date.now(), action: "dismissed",
                                  enhancement: aiSuggestion.suggestedEnhancement,
                                  filter: aiSuggestion.suggestedFilter ?? undefined,
                                  imageType: inferImageType(aiSuggestion.detectedSubjects),
                                  confidence: aiSuggestion.confidence,
                                });
                                setAiSuggestion(null);
                              }}
                              className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1"
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                        );
                      })()}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Workflow stepper — interactive 3-step wizard:
                    1) Enhance: pick a primary enhancement (auto_face is default for portraits)
                    2) Filter:  optionally stack a creative filter on top
                    3) Upscale: optionally upscale 2x or 4x as the last step
                    Each chip is a button that scrolls to its section AND
                    sets the "current step" highlight. Photo runs all three
                    stages via POST /media/enhance-chain (single job). Video
                    forwards filterId + upscale through /media/enhance →
                    /restore-video so users get parity with images. */}
                {file && (() => {
                  // Derived current step: 1 until enhancement is set, then
                  // 2 until a filter is picked, then 3 once upscale appears.
                  const currentStep: 1 | 2 | 3 =
                    upscaleAfter ? 3 : selectedFilter ? 2 : 1;
                  const scrollTo = (id: string) => {
                    const el = document.getElementById(id);
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                  };
                  return (
                    <div
                      className="mb-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2"
                      aria-label="Editing workflow"
                    >
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5 px-0.5">
                        <span>Workflow</span>
                        <span className="text-zinc-700">·</span>
                        <span className="text-zinc-600">Enhance, then filter, then upscale</span>
                      </div>
                      <div className="flex items-center gap-1" role="tablist">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={currentStep === 1}
                          onClick={() => scrollTo("workflow-step-enhance")}
                          className={cn(
                            "flex-1 flex items-center gap-1 rounded-md px-1.5 py-1 border text-[10px] transition-colors",
                            currentStep === 1
                              ? "border-teal-400 bg-teal-500/20 text-teal-100 ring-1 ring-teal-400/40"
                              : enhancementType
                                ? "border-teal-500/50 bg-teal-500/10 text-teal-200 hover:border-teal-400"
                                : "border-zinc-800 text-zinc-500 hover:border-zinc-600",
                          )}
                        >
                          <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-zinc-800 text-[9px] font-bold">1</span>
                          <Sparkles className="w-3 h-3 shrink-0" />
                          <span className="truncate">Enhance</span>
                        </button>
                        <ChevronRight className="w-3 h-3 text-zinc-700 shrink-0" aria-hidden />
                        <button
                          type="button"
                          role="tab"
                          aria-selected={currentStep === 2}
                          onClick={() => scrollTo("workflow-step-filter")}
                          className={cn(
                            "flex-1 flex items-center gap-1 rounded-md px-1.5 py-1 border text-[10px] transition-colors",
                            currentStep === 2
                              ? "border-violet-400 bg-violet-500/20 text-violet-100 ring-1 ring-violet-400/40"
                              : selectedFilter
                                ? "border-violet-500/50 bg-violet-500/10 text-violet-200 hover:border-violet-400"
                                : "border-zinc-800 text-zinc-500 hover:border-zinc-600",
                          )}
                        >
                          <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-zinc-800 text-[9px] font-bold">2</span>
                          <Palette className="w-3 h-3 shrink-0" />
                          <span className="truncate">Filter</span>
                        </button>
                        <ChevronRight className="w-3 h-3 text-zinc-700 shrink-0" aria-hidden />
                        <button
                          type="button"
                          role="tab"
                          aria-selected={currentStep === 3}
                          onClick={() => scrollTo("workflow-step-upscale")}
                          className={cn(
                            "flex-1 flex items-center gap-1 rounded-md px-1.5 py-1 border text-[10px] transition-colors",
                            currentStep === 3
                              ? "border-cyan-400 bg-cyan-500/20 text-cyan-100 ring-1 ring-cyan-400/40"
                              : upscaleAfter
                                ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-200 hover:border-cyan-400"
                                : "border-zinc-800 text-zinc-500 hover:border-zinc-600",
                          )}
                        >
                          <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-zinc-800 text-[9px] font-bold">3</span>
                          <ZoomIn className="w-3 h-3 shrink-0" />
                          <span className="truncate">{upscaleAfter === "upscale_4x" ? "4x" : upscaleAfter === "upscale" ? "2x" : "Upscale"}</span>
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* SIMPLE MODE */}
                {editorMode === "simple" && (
                  <div className="space-y-3">
                    {/* ── Face Restoration mode selector ─────────────────────
                        A dedicated, always-visible toggle row that exposes the
                        four face-restoration paths under user-friendly names
                        ("Auto Face" / "Classic Restore" / "Detailed
                        Refinement" / "Studio Restore"). Tooltips show the
                        plain-English effect to every user; admins additionally
                        see the underlying model + pipeline detail in the
                        same tooltip via `getFaceRestorationDisplay(type, isAdmin)`.
                        Picking a pill flips `enhancementType` and — if a file
                        is already loaded — auto-triggers `handleProcess` via
                        `pendingAutoProcessRef + autoProcessTick`, so the
                        result appears without a second click. */}
                    <div id="workflow-step-face-model" className="space-y-1.5 scroll-mt-4">
                      <Label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                        Face Restoration
                      </Label>
                      <div role="radiogroup" aria-label="Face restoration mode" className="grid grid-cols-4 gap-1.5">
                        {([
                          { type: "auto_face" as EnhanceMediaBodyEnhancementType, short: "Auto",     icon: <Sparkles className="w-3.5 h-3.5" /> },
                          { type: "face_restore" as EnhanceMediaBodyEnhancementType, short: "Classic",  icon: <ScanFace className="w-3.5 h-3.5" /> },
                          { type: "codeformer" as EnhanceMediaBodyEnhancementType, short: "Detailed", icon: <ScanEye className="w-3.5 h-3.5" /> },
                          { type: "hybrid" as EnhanceMediaBodyEnhancementType, short: "Studio",   icon: <Layers className="w-3.5 h-3.5" /> },
                        ]).map((m) => {
                          const locked = isFeatureLocked(m.type);
                          const active = enhancementType === m.type;
                          const display = getFaceRestorationDisplay(m.type, isAdmin);
                          return (
                            <Tooltip key={m.type}>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  role="radio"
                                  aria-checked={active}
                                  aria-label={`${display.label} face restoration mode`}
                                  disabled={locked}
                                  onClick={() => {
                                    if (locked) {
                                      toast({ title: `${tierLabel(m.type)} feature`, description: `Upgrade to ${tierLabel(m.type)} to unlock ${display.label}.`, variant: "destructive" });
                                      return;
                                    }
                                    pushUndo();
                                    setEnhancementType(m.type);
                                    setSelectedFilter(null);
                                    setFilters(DEFAULT_FILTERS);
                                    if (file && processStage !== "uploading" && processStage !== "processing") {
                                      pendingAutoProcessRef.current = { source: `face-model:${m.type}` };
                                      setAutoProcessTick((t) => t + 1);
                                    }
                                  }}
                                  className={cn(
                                    "flex flex-col items-center justify-center gap-1 h-12 rounded-md border text-[10px] font-medium transition-all",
                                    locked
                                      ? "border-zinc-800 bg-zinc-900/30 text-zinc-600 opacity-60 cursor-not-allowed"
                                      : active
                                      ? "border-teal-500 bg-teal-500/10 text-teal-200 shadow shadow-teal-500/10"
                                      : "border-zinc-800 bg-zinc-900/50 text-zinc-300 hover:bg-zinc-800 hover:border-zinc-700",
                                  )}
                                >
                                  <span className={cn("inline-flex items-center justify-center", active ? "text-teal-300" : "text-zinc-400")}>
                                    {m.icon}
                                  </span>
                                  <span className="leading-none">{m.short}</span>
                                  {locked && (
                                    <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-amber-500/90 flex items-center justify-center">
                                      <Lock className="w-2 h-2 text-zinc-900" />
                                    </span>
                                  )}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="max-w-[300px] text-xs leading-snug p-2.5">
                                {locked ? (
                                  `🔒 ${tierLabel(m.type)} — Upgrade to unlock`
                                ) : (
                                  <div className="space-y-1.5">
                                    <div className="font-semibold text-zinc-100 text-sm">{display.label}</div>
                                    <div className="text-zinc-300">{display.desc}</div>
                                    {isAdmin && display.technical && (
                                      <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 space-y-1">
                                        <div className="flex items-center gap-1.5">
                                          <span className="inline-block text-[9px] font-bold uppercase tracking-wider text-amber-200 bg-amber-500/25 px-1.5 py-0.5 rounded">Admin</span>
                                          <span className="text-[10px] text-amber-300/80">Technical detail</span>
                                        </div>
                                        <div className="text-[11px] text-amber-50 leading-relaxed">{display.technical}</div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </div>
                      <p className="text-[10px] text-zinc-500 leading-snug">
                        Stay on <span className="text-teal-300">Auto Face</span> for the safest defaults —
                        face restoration runs only on old or damaged photos. Clean portraits get a gentle natural enhance.
                      </p>
                    </div>

                    <div id="workflow-step-enhance" className="space-y-1.5 scroll-mt-4">
                      <Label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">1. Enhance — Quick presets</Label>
                      <div className="grid grid-cols-5 gap-1.5">
                        {SIMPLE_PRESETS.map((p) => {
                          const locked = isFeatureLocked(p.type);
                          return (
                          <Tooltip key={p.type + (p.filterName ?? "")}>
                            <TooltipTrigger asChild>
                              <motion.button
                                whileTap={{ scale: 0.97 }}
                                className={cn(
                                  "flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-all text-center relative",
                                  locked
                                    ? "border-zinc-800 bg-zinc-900/30 opacity-60 cursor-not-allowed"
                                    : enhancementType === p.type && !selectedFilter
                                    ? "border-teal-500 bg-teal-500/10 shadow-lg shadow-teal-500/10"
                                    : "border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 hover:border-zinc-700",
                                )}
                                onClick={() => {
                                  if (locked) {
                                    toast({ title: `${tierLabel(p.type)} feature`, description: `Upgrade to ${tierLabel(p.type)} to unlock ${p.label}.`, variant: "destructive" });
                                    return;
                                  }
                                  pushUndo();
                                  setEnhancementType(p.type);
                                  setSelectedFilter(null);
                                  setFilters(DEFAULT_FILTERS);
                                }}
                              >
                                {locked && (
                                  <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500/90 flex items-center justify-center z-10">
                                    <Lock className="w-2.5 h-2.5 text-zinc-900 z-30" />
                                  </div>
                                )}
                                <div className={cn(
                                  "w-8 h-8 rounded-md flex items-center justify-center shrink-0 transition-colors [&_svg]:w-4 [&_svg]:h-4",
                                  locked ? "bg-zinc-800/50 text-zinc-600"
                                  : enhancementType === p.type && !selectedFilter ? "bg-teal-500/20 text-teal-400" : "bg-zinc-800 text-zinc-400",
                                )}>
                                  {p.icon}
                                </div>
                                <p className="text-[10px] font-medium leading-tight truncate w-full">{p.label}</p>
                              </motion.button>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-[280px] text-xs leading-snug p-2.5">
                              {locked ? (
                                `🔒 ${tierLabel(p.type)} — Upgrade to unlock`
                              ) : (() => {
                                // Face-restoration presets surface admin-only technical
                                // detail; everyone else just sees the friendly desc.
                                const faceDisplay = getFaceRestorationDisplay(p.type, isAdmin);
                                const isFaceType = ["auto_face","face_restore","face_restore_hd","codeformer","hybrid","old_photo_restore"].includes(p.type);
                                if (isFaceType && isAdmin && faceDisplay.technical) {
                                  return (
                                    <div className="space-y-1.5">
                                      <div className="font-semibold text-zinc-100 text-sm">{p.label}</div>
                                      <div className="text-zinc-300">{p.desc}</div>
                                      <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 space-y-1">
                                        <div className="flex items-center gap-1.5">
                                          <span className="inline-block text-[9px] font-bold uppercase tracking-wider text-amber-200 bg-amber-500/25 px-1.5 py-0.5 rounded">Admin</span>
                                          <span className="text-[10px] text-amber-300/80">Technical detail</span>
                                        </div>
                                        <div className="text-[11px] text-amber-50 leading-relaxed">{faceDisplay.technical}</div>
                                      </div>
                                    </div>
                                  );
                                }
                                return p.desc;
                              })()}
                            </TooltipContent>
                          </Tooltip>
                        );
                        })}
                      </div>
                    </div>

                    {mediaType === "video" && (
                      <>
                        <Separator className="bg-white/5" />
                        <div className="space-y-3">
                          <Label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Video Options</Label>
                          {!canAccessBasic ? (
                            <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                              <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                              <div>
                                <p className="text-xs font-medium text-amber-300">Basic+ Feature</p>
                                <p className="text-[10px] text-zinc-400">Upgrade to Basic or Premium to access video enhancements.</p>
                              </div>
                            </div>
                          ) : (
                          <div className="flex items-center justify-between p-3 rounded-lg border border-zinc-800 bg-zinc-900/50">
                            <div>
                              <p className="text-sm font-medium">AI Stabilization</p>
                              <p className="text-xs text-zinc-500 mt-0.5">Remove camera shake</p>
                            </div>
                            <Switch checked={stabilize} onCheckedChange={setStabilize} />
                          </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* ADVANCED MODE */}
                {editorMode === "advanced" && (
                  <Tabs defaultValue="enhance">
                    <TabsList className="grid grid-cols-5 w-full bg-zinc-900 mb-4 h-9">
                      <TabsTrigger value="enhance"   className="text-xs px-1 gap-1"><Wand2             className="w-3 h-3" />AI</TabsTrigger>
                      <TabsTrigger value="adjust"    className="text-xs px-1 gap-1"><Contrast          className="w-3 h-3" />Adjust</TabsTrigger>
                      <TabsTrigger value="transform" className="text-xs px-1 gap-1"><RotateCw          className="w-3 h-3" />Xform</TabsTrigger>
                      <TabsTrigger value="filters"   className="text-xs px-1 gap-1"><SlidersHorizontal className="w-3 h-3" />Filters</TabsTrigger>
                      {mediaType === "video"
                        ? <TabsTrigger value="video" className="text-xs px-1 gap-1"><Film className="w-3 h-3" />Video</TabsTrigger>
                        : <TabsTrigger value="crop"  className="text-xs px-1 gap-1"><Crop className="w-3 h-3" />Crop</TabsTrigger>
                      }
                    </TabsList>

                    {/* AI Enhance */}
                    <TabsContent value="enhance" className="space-y-5 mt-0">
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Enhancement Type</Label>
                        <div className="grid grid-cols-2 gap-1.5">
                          {ENHANCEMENT_TYPES.map(({ type, label, icon }) => {
                            const locked = isFeatureLocked(type);
                            return (
                            <Button key={type} variant="outline" size="sm"
                              className={cn("justify-start gap-2 border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 h-8 text-xs relative",
                                locked ? "opacity-50 cursor-not-allowed" :
                                enhancementType === type && "border-teal-500 text-teal-400 bg-teal-500/10 hover:bg-teal-500/20")}
                              onClick={() => {
                                if (locked) {
                                  toast({ title: `${tierLabel(type)} feature`, description: `Upgrade to ${tierLabel(type)} to unlock ${label}.`, variant: "destructive" });
                                  return;
                                }
                                setEnhancementType(type);
                              }}>
                              {icon}{label}
                              {locked && <Lock className="w-3 h-3 text-amber-400 ml-auto" />}
                            </Button>
                          );
                          })}
                        </div>
                      </div>

                      {/* Skin smoothing control */}
                      {(enhancementType === "skin_retouch" || enhancementType === "beauty" || enhancementType === "portrait") && (
                        <>
                          <Separator className="bg-white/5" />
                          <div className="space-y-2">
                            <div className="flex justify-between">
                              <Label className="text-xs text-zinc-400">Skin Smoothing</Label>
                              <span className="text-xs text-zinc-500 tabular-nums">{skinSmoothing}%</span>
                            </div>
                            <Slider min={0} max={100} step={1} value={[skinSmoothing]} onValueChange={([v]) => setSkinSmoothing(v)} />
                          </div>
                        </>
                      )}

                      {presets && presets.length > 0 && (
                        <>
                          <Separator className="bg-white/5" />
                          <div className="space-y-2">
                            <Label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Style Presets</Label>
                            <div className="space-y-1.5">
                              {presets.map((preset) => (
                                <Button key={preset.id} variant="outline" size="sm"
                                  className={cn("w-full justify-between border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800",
                                    presetId === preset.id && "border-teal-500 text-teal-400 bg-teal-500/10")}
                                  onClick={() => setPresetId(preset.id === presetId ? undefined : preset.id)}>
                                  <span className="flex items-center gap-2">
                                    <Sparkles className={cn("w-3 h-3", preset.isPremium ? "text-amber-400" : "text-zinc-500")} />
                                    {preset.name}
                                  </span>
                                  {preset.isPremium && (
                                    <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-400 px-1 py-0 h-4">PRO</Badge>
                                  )}
                                </Button>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </TabsContent>

                    {/* Adjust (NEW — warmth, highlights, shadows, hue) */}
                    <TabsContent value="adjust" className="space-y-4 mt-0">
                      {!canAccessPremium && (
                        <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2">
                          <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <p className="text-[10px] text-amber-300/80">Fine-tuned adjustments are a <span className="font-semibold text-amber-300">Premium</span> feature. Basic sliders available as preview.</p>
                        </div>
                      )}
                      <p className="text-[10px] text-zinc-600 mb-2">Fine-tune color & lighting in real time</p>
                      {([
                        { key: "brightness" as const, label: "Brightness",  icon: <Sun          className="w-3 h-3" />, min: 0,    max: 200, step: 1 },
                        { key: "contrast"   as const, label: "Contrast",    icon: <Contrast     className="w-3 h-3" />, min: 0,    max: 200, step: 1 },
                        { key: "saturation" as const, label: "Saturation",  icon: <Palette      className="w-3 h-3" />, min: 0,    max: 200, step: 1 },
                        { key: "sharpness"  as const, label: "Sharpness",   icon: <CircleDot    className="w-3 h-3" />, min: 0,    max: 200, step: 1 },
                        { key: "warmth"     as const, label: "Warmth",      icon: <Thermometer  className="w-3 h-3" />, min: -50,  max: 50,  step: 1 },
                        { key: "highlights" as const, label: "Highlights",  icon: <Sun          className="w-3 h-3" />, min: -100, max: 100, step: 1 },
                        { key: "shadows"    as const, label: "Shadows",     icon: <Mountain     className="w-3 h-3" />, min: -100, max: 100, step: 1 },
                        { key: "hue"        as const, label: "Hue Shift",   icon: <Droplets     className="w-3 h-3" />, min: -180, max: 180, step: 1 },
                      ]).map(({ key, label, icon, min, max, step }) => (
                        <div key={key} className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs text-zinc-400 flex items-center gap-1.5">{icon}{label}</Label>
                            <span className="text-xs text-zinc-500 tabular-nums w-10 text-right">{filters[key]}</span>
                          </div>
                          <Slider min={min} max={max} step={step} value={[filters[key]]}
                            onValueChange={([v]) => {
                              pushUndo();
                              setFilters((f) => ({ ...f, [key]: v }));
                            }} />
                        </div>
                      ))}
                      <Separator className="bg-white/5" />
                      <Button variant="ghost" size="sm" className="w-full text-zinc-500 hover:text-zinc-300"
                        onClick={() => setFilters(DEFAULT_FILTERS)}>Reset All</Button>
                    </TabsContent>

                    {/* Transform */}
                    <TabsContent value="transform" className="space-y-5 mt-0">
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Rotate</Label>
                        <div className="grid grid-cols-2 gap-2">
                          <Button variant="outline" size="sm" className="gap-2 border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800"
                            onClick={() => { pushUndo(); setTransform((t) => ({ ...t, rotation: (t.rotation - 90 + 360) % 360 })); }}>
                            <RotateCcw className="w-3.5 h-3.5" />CCW
                          </Button>
                          <Button variant="outline" size="sm" className="gap-2 border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800"
                            onClick={() => { pushUndo(); setTransform((t) => ({ ...t, rotation: (t.rotation + 90) % 360 })); }}>
                            <RotateCw className="w-3.5 h-3.5" />CW
                          </Button>
                        </div>
                        {transform.rotation !== 0 && (
                          <p className="text-xs text-zinc-500 text-center">{transform.rotation}° applied</p>
                        )}
                      </div>
                      <Separator className="bg-white/5" />
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Flip</Label>
                        <div className="grid grid-cols-2 gap-2">
                          <Button variant="outline" size="sm"
                            className={cn("gap-2 border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800", transform.flipH && "border-teal-500 text-teal-400 bg-teal-500/10")}
                            onClick={() => setTransform((t) => ({ ...t, flipH: !t.flipH }))}>
                            <FlipHorizontal2 className="w-3.5 h-3.5" />Horiz
                          </Button>
                          <Button variant="outline" size="sm"
                            className={cn("gap-2 border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800", transform.flipV && "border-teal-500 text-teal-400 bg-teal-500/10")}
                            onClick={() => setTransform((t) => ({ ...t, flipV: !t.flipV }))}>
                            <FlipVertical2 className="w-3.5 h-3.5" />Vert
                          </Button>
                        </div>
                      </div>
                      <Separator className="bg-white/5" />
                      <Button variant="ghost" size="sm" className="w-full text-zinc-500 hover:text-zinc-300"
                        onClick={() => setTransform(DEFAULT_TRANSFORM)}>Reset Transform</Button>
                    </TabsContent>

                    {/* Filters (Advanced) */}
                    <TabsContent value="filters" className="space-y-4 mt-0">
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Filter Gallery</Label>
                        <div className="grid grid-cols-4 gap-1.5">
                          {FILTER_PRESETS.map((p) => {
                            const filterLocked = isFeatureLocked("filter", p.key);
                            const isSelected = selectedFilter === p.key;
                            return (
                            <motion.button
                              key={p.key}
                              whileHover={filterLocked ? undefined : { scale: 1.04 }}
                              whileTap={filterLocked ? undefined : { scale: 0.96 }}
                              transition={{ type: "spring", stiffness: 320, damping: 20 }}
                              className={cn(
                                "relative rounded-lg border overflow-hidden h-12 transition-colors",
                                filterLocked
                                  ? "border-zinc-800 opacity-50 cursor-not-allowed"
                                  : isSelected ? "border-teal-500 ring-2 ring-teal-500/40 shadow-md shadow-teal-500/20" : "border-zinc-800 hover:border-zinc-600",
                              )}
                              onClick={() => {
                                if (filterLocked) {
                                  toast({ title: "Premium filter", description: `Upgrade to Premium to unlock ${p.name}.`, variant: "destructive" });
                                  return;
                                }
                                pushUndo();
                                setSelectedFilter(p.key === "original" ? null : p.key);
                              }}>
                              <div className={cn("absolute inset-0 bg-gradient-to-br opacity-60", p.gradient)} />
                              <div className="absolute inset-0 flex items-end p-1">
                                <span className="text-[8px] font-medium text-white drop-shadow-lg">{p.name}</span>
                              </div>
                              {isSelected && !filterLocked && (
                                <motion.div
                                  initial={{ scale: 0.4, opacity: 0 }}
                                  animate={{ scale: 1, opacity: 1 }}
                                  transition={{ type: "spring", stiffness: 320, damping: 18 }}
                                  className="absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-teal-500 flex items-center justify-center shadow-md shadow-teal-500/40"
                                >
                                  <CheckCircle2 className="w-2.5 h-2.5 text-zinc-950" />
                                </motion.div>
                              )}
                              {filterLocked ? (
                                <div className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-amber-500/90 flex items-center justify-center">
                                  <Lock className="w-2 h-2 text-zinc-900" />
                                </div>
                              ) : p.premium && !isSelected && <div className="absolute top-0.5 right-0.5"><div className="w-1.5 h-1.5 rounded-full bg-amber-400" /></div>}
                            </motion.button>
                          );
                          })}
                        </div>
                      </div>
                      <Separator className="bg-white/5" />
                      <Button variant="ghost" size="sm" className="w-full text-zinc-500 hover:text-zinc-300"
                        onClick={() => { setFilters(DEFAULT_FILTERS); setSelectedFilter(null); }}>Reset Filters</Button>
                    </TabsContent>

                    {/* Crop */}
                    <TabsContent value="crop" className="space-y-4 mt-0">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">Enable Crop</p>
                          <p className="text-xs text-zinc-500 mt-0.5">Trim edges before enhancement</p>
                        </div>
                        <Switch checked={cropEnabled} onCheckedChange={setCropEnabled} />
                      </div>
                      <Separator className="bg-white/5" />
                      {([
                        { key: "x" as const,  label: "Left %",   min: 0,             max: cropBox.x2 - 5 },
                        { key: "y" as const,  label: "Top %",    min: 0,             max: cropBox.y2 - 5 },
                        { key: "x2" as const, label: "Right %",  min: cropBox.x + 5, max: 100            },
                        { key: "y2" as const, label: "Bottom %", min: cropBox.y + 5, max: 100            },
                      ]).map(({ key, label, min, max }) => (
                        <div key={key} className="space-y-2">
                          <div className="flex justify-between">
                            <Label className="text-xs text-zinc-400">{label}</Label>
                            <span className="text-xs text-zinc-500 tabular-nums">{cropBox[key]}%</span>
                          </div>
                          <Slider min={min} max={max} step={1} value={[cropBox[key]]}
                            disabled={!cropEnabled}
                            className={cn(!cropEnabled && "opacity-40")}
                            onValueChange={([v]) => setCropBox((b) => ({ ...b, [key]: v }))} />
                        </div>
                      ))}
                      <Button variant="ghost" size="sm" className="w-full text-zinc-500 hover:text-zinc-300"
                        disabled={!cropEnabled} onClick={() => setCropBox(DEFAULT_CROP)}>Reset Crop</Button>
                    </TabsContent>

                    {/* Video */}
                    <TabsContent value="video" className="space-y-4 mt-0">
                      <div className="space-y-3">
                        {/* Speed Control */}
                        <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-900/50 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Gauge className="w-3.5 h-3.5 text-teal-400" />
                              <p className="text-sm font-medium">Speed</p>
                            </div>
                            <span className="text-xs font-mono text-teal-400">{videoSpeed.toFixed(2)}x</span>
                          </div>
                          <Slider
                            value={[videoSpeed]}
                            min={0.25} max={4} step={0.25}
                            onValueChange={([v]) => setVideoSpeed(v)}
                            className="py-1"
                          />
                          <div className="flex justify-between text-[10px] text-zinc-600">
                            <span>0.25x</span><span>1x</span><span>2x</span><span>4x</span>
                          </div>
                        </div>

                        {/* Trim Controls */}
                        <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-900/50 space-y-2">
                          <div className="flex items-center gap-2">
                            <Scissors className="w-3.5 h-3.5 text-teal-400" />
                            <p className="text-sm font-medium">Trim</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <Label className="text-[10px] text-zinc-500">Start %</Label>
                              <Slider
                                value={[trimStart]}
                                min={0} max={trimEnd - 1} step={1}
                                onValueChange={([v]) => setTrimStart(v)}
                                className="py-1"
                              />
                            </div>
                            <div className="flex-1">
                              <Label className="text-[10px] text-zinc-500">End %</Label>
                              <Slider
                                value={[trimEnd]}
                                min={trimStart + 1} max={100} step={1}
                                onValueChange={([v]) => setTrimEnd(v)}
                                className="py-1"
                              />
                            </div>
                          </div>
                          <p className="text-[10px] text-zinc-500">Keep {trimStart}% – {trimEnd}% of video</p>
                        </div>

                        {/* Audio */}
                        <div className="flex items-center justify-between p-3 rounded-lg border border-zinc-800 bg-zinc-900/50">
                          <div className="flex items-center gap-2">
                            {muteAudio ? <VolumeX className="w-3.5 h-3.5 text-zinc-500" /> : <Volume2 className="w-3.5 h-3.5 text-teal-400" />}
                            <div>
                              <p className="text-sm font-medium">Mute Audio</p>
                              <p className="text-xs text-zinc-500 mt-0.5">Strip audio track from output</p>
                            </div>
                          </div>
                          <Switch checked={muteAudio} onCheckedChange={setMuteAudio} />
                        </div>

                        {/* AI Stabilization */}
                        <div className="flex items-center justify-between p-3 rounded-lg border border-zinc-800 bg-zinc-900/50">
                          <div>
                            <p className="text-sm font-medium">AI Stabilization</p>
                            <p className="text-xs text-zinc-500 mt-0.5">Remove camera shake with AI</p>
                          </div>
                          <Switch checked={stabilize} onCheckedChange={setStabilize} />
                        </div>

                        {/* Noise Reduction */}
                        <div className="flex items-center justify-between p-3 rounded-lg border border-zinc-800 bg-zinc-900/50">
                          <div>
                            <p className="text-sm font-medium">Noise Reduction</p>
                            <p className="text-xs text-zinc-500 mt-0.5">Reduce grain &amp; video noise</p>
                          </div>
                          <Switch checked={denoise} onCheckedChange={setDenoise} />
                        </div>

                        {/* Video Color Grading */}
                        <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-900/50 space-y-2">
                          <div className="flex items-center gap-2">
                            <Film className="w-3.5 h-3.5 text-teal-400" />
                            <p className="text-sm font-medium">Cinematic Edits</p>
                            <span className="ml-auto inline-flex items-center rounded-full border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider text-cyan-200" title="The same color grades work on photos and videos.">
                              Photo + Video
                            </span>
                          </div>
                          <p className="text-[10px] text-zinc-500 -mt-1">
                            Same look across stills and frames — toggle on the photo flow too.
                          </p>
                          <div className="grid grid-cols-3 gap-1.5">
                            {[
                              { key: "cinematic", label: "Cinematic", gradient: "from-teal-600 to-cyan-800" },
                              { key: "warm", label: "Warm", gradient: "from-orange-500 to-red-600" },
                              { key: "cool", label: "Cool", gradient: "from-blue-500 to-indigo-600" },
                              { key: "vintage", label: "Vintage", gradient: "from-amber-500 to-orange-700" },
                              { key: "vivid", label: "Vivid", gradient: "from-pink-500 to-red-500" },
                              { key: "bw", label: "B&W", gradient: "from-zinc-400 to-zinc-700" },
                            ].map(g => (
                              <button
                                key={g.key}
                                className={cn(
                                  "relative rounded-md border overflow-hidden h-8 transition-all",
                                  videoColorGrade === g.key ? "border-teal-500 ring-1 ring-teal-500/30" : "border-zinc-800 hover:border-zinc-600",
                                )}
                                onClick={() => setVideoColorGrade(videoColorGrade === g.key ? null : g.key)}
                              >
                                <div className={cn("absolute inset-0 bg-gradient-to-br opacity-60", g.gradient)} />
                                <span className="relative text-[9px] font-medium text-white drop-shadow-lg">{g.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Frame Capture hint */}
                        <div className="flex items-center gap-2 p-3 rounded-lg border border-zinc-800 bg-zinc-900/50">
                          <Camera className="w-3.5 h-3.5 text-zinc-400" />
                          <div>
                            <p className="text-sm font-medium text-zinc-300">Frame Capture</p>
                            <p className="text-xs text-zinc-500 mt-0.5">Pause video in preview, then capture current frame as an image for photo enhancement.</p>
                          </div>
                        </div>

                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                          <p className="text-xs text-amber-400/80">Video processing may take up to 60 s depending on length and resolution.</p>
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                )}
              </div>
            </ScrollArea>

            {/* Process button */}
            <div className="p-3 border-t border-white/10 space-y-2">
              <AnimatePresence>
                {processStage !== "idle" && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="space-y-2"
                  >
                    {/* Step-by-step timeline. Stages flex to include the
                        filter and upscale steps only when the user opted
                        in, so the indicator always matches the actual
                        chain that's running. */}
                    {(() => {
                      const hasFilter = !!selectedFilter;
                      const hasUpscale = !!upscaleAfter;
                      const upscaleRunning = upscaleChainRef.current === true;
                      type Status = "pending" | "active" | "done" | "failed";
                      const failedAt = processStage === "failed";
                      const stages: { key: string; label: string; detail?: string; status: Status }[] = [];
                      // Step 1: upload
                      stages.push({
                        key: "upload",
                        label: "Upload",
                        detail: file?.name ? file.name.length > 16 ? file.name.slice(0, 14) + "…" : file.name : undefined,
                        status: processStage === "uploading"
                          ? "active"
                          : (processStage === "processing" || processStage === "completed" || processStage === "failed") ? "done" : "pending",
                      });
                      // Step 2: enhance
                      stages.push({
                        key: "enhance",
                        label: "Enhance",
                        detail: enhancementType ? getEnhancementMeta(enhancementType).shortLabel : undefined,
                        status: failedAt && !upscaleRunning
                          ? "failed"
                          : processStage === "processing" && !upscaleRunning
                            ? "active"
                            : (upscaleRunning || processStage === "completed")
                              ? "done"
                              : "pending",
                      });
                      // Step 3 (optional): filter
                      if (hasFilter) {
                        stages.push({
                          key: "filter",
                          label: "Filter",
                          detail: selectedFilter ?? undefined,
                          // Filter is part of the same enhance call on the
                          // server, so it follows the enhance status.
                          status: failedAt
                            ? "pending"
                            : processStage === "completed"
                              ? "done"
                              : processStage === "processing"
                                ? "active"
                                : "pending",
                        });
                      }
                      // Step 4 (optional): upscale
                      if (hasUpscale) {
                        stages.push({
                          key: "upscale",
                          label: "Upscale",
                          detail: upscaleAfter === "upscale_4x" ? "4×" : "2×",
                          status: failedAt && upscaleRunning
                            ? "failed"
                            : upscaleRunning
                              ? "active"
                              : processStage === "completed"
                                ? "done"
                                : "pending",
                        });
                      }
                      return <ProgressTimeline stages={stages} compact />;
                    })()}
                    <div className={cn("flex items-center gap-2 text-xs", stageInfo.colorClass)}>
                      {(processStage === "uploading" || processStage === "processing") && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {processStage === "completed" && <CheckCircle2 className="w-3.5 h-3.5" />}
                      {processStage === "failed"    && <AlertCircle  className="w-3.5 h-3.5" />}
                      <span className="text-xs">{processStage === "processing" && currentJob?.errorMessage ? currentJob.errorMessage : stageInfo.label}</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              {/* In batch mode the bottom action triggers the queue, not a
                  single-file enhancement. handleBatchProcess uses the same
                  enhancement / filter / upscale settings the side panel
                  drives (selectedFilter is shared state), so picking "No
                  Filter" or any chip here applies to every queued file. */}
              {isBatchActive && !file ? (
                /* When every queued image has been processed (or failed) the
                   primary action flips from "Process Batch" to "Start New
                   Batch" — a single, prominent control right where the user
                   is already looking. Clicking it clears the queue without a
                   page reload so they can drop new files immediately. */
                batchProcessableCount === 0 && batchItems.length > 0 && !isBatchProcessing ? (
                  <Button
                    className="w-full bg-emerald-500 hover:bg-emerald-600 text-zinc-950 font-semibold shadow-lg shadow-emerald-500/20 h-11"
                    onClick={resetBatchSession}
                  >
                    <RefreshCw className="w-4 h-4 mr-2" /> Start New Batch
                  </Button>
                ) : (
                  <Button
                    className="w-full bg-amber-500 hover:bg-amber-600 text-zinc-950 font-semibold shadow-lg shadow-amber-500/20 h-11"
                    onClick={handleBatchProcess}
                    disabled={isBatchProcessing || batchProcessableCount === 0}
                  >
                    {isBatchProcessing ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processing batch…</>
                    ) : (
                      <><Layers className="w-4 h-4 mr-2" /> Process Batch ({batchProcessableCount})</>
                    )}
                  </Button>
                )
              ) : (
                <Button
                  className="w-full bg-teal-600 hover:bg-teal-700 text-white shadow-lg shadow-teal-500/20 h-11"
                  onClick={handleProcess}
                  disabled={!file || isProcessing}
                >
                  {isProcessing
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{upscaleChainRef.current ? "Upscaling..." : "Processing..."}</>
                    : <><Wand2   className="w-4 h-4 mr-2" />{isCompleted ? "Enhance Again" : (upscaleAfter ? `Enhance + ${upscaleAfter === "upscale_4x" ? "4x" : "2x"} Upscale` : "Enhance Media")}</>
                  }
                </Button>
              )}
            </div>
          </aside>

          {/* Main Preview */}
          <main className="flex-1 bg-zinc-900 relative flex flex-col min-h-0 min-w-0">
            <div className="flex-1 flex items-center justify-center py-4 pl-4 pr-4 sm:pl-6 sm:pr-6 lg:pl-12 lg:pr-8 xl:pl-16 xl:pr-10 2xl:pl-20 2xl:pr-12 overflow-hidden min-h-0">
              {(isBatchMode || batchItems.length > 0) && !file && !canAccessPremium ? (
                /* Batch processing is a Premium feature. Non-premium users
                   land on a Premium-locked card instead of the Batch Studio
                   so the gating is unambiguous and the upgrade path is one
                   click away. Server-side `maxBatchJobsForPlan` already
                   enforces this — the UI gate prevents users from queueing
                   files only to fail at submit time. */
                <motion.div
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="w-full max-w-2xl mx-auto"
                >
                  <Card className="border border-amber-500/40 bg-zinc-950/80">
                    <CardContent className="p-8 flex flex-col items-center text-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-amber-500/15 flex items-center justify-center">
                        <Layers className="w-6 h-6 text-amber-300" />
                      </div>
                      <div>
                        <h2 className="text-xl font-semibold text-zinc-100">Batch processing is a Premium feature</h2>
                        <p className="text-sm text-zinc-400 mt-2 max-w-md mx-auto">
                          Queue multiple photos or videos and process them in a single run. Available on the Premium
                          plan or with one-time credit packs that include batch capability.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 justify-center">
                        <Button
                          onClick={() => { window.location.href = "/pricing"; }}
                          className="bg-amber-500 hover:bg-amber-600 text-zinc-950 font-semibold"
                        >
                          Upgrade to Premium
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => { window.location.href = "/billing"; }}
                          className="border-fuchsia-500/50 text-fuchsia-300 hover:bg-fuchsia-500/10"
                        >
                          Buy a credit pack
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => { window.location.href = "/photo-studio"; }}
                          className="text-zinc-400 hover:text-zinc-200"
                        >
                          Continue with single-file editing
                        </Button>
                      </div>
                      <p className="text-[11px] text-zinc-500 max-w-md">
                        Need help choosing? Email{" "}
                        <a href={supportMailto("Batch processing access", "Hello,\n\nI'd like to understand my options for batch processing.\n\nThanks.")} className="text-teal-400 hover:underline">
                          support
                        </a>
                        .
                      </p>
                    </CardContent>
                  </Card>
                </motion.div>
              ) : (isBatchMode || batchItems.length > 0) && !file ? (
                /* Single outer rail (`max-w-5xl mx-auto`) shared by BOTH the
                   preview and the Batch Studio card so their left/right edges
                   line up exactly. `h-full overflow-y-auto` keeps everything
                   inside the main panel — if combined content is taller than
                   the viewport, the rail scrolls instead of bleeding into the
                   header. `pr-1` reserves room for the scrollbar so it never
                   overlaps the rounded preview frame. */
                <motion.div
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="w-full max-w-5xl mx-auto flex flex-col gap-3 min-h-0 h-full overflow-y-auto pr-1"
                >
                  {/* ── Batch sample preview ────────────────────────────────────
                      Renders ONE queued image as the live "what will it look
                      like?" preview. The same `previewStyle` (CSS filter +
                      transform stack) used by the single-file flow is applied
                      locally — every chip click is instant and never hits the
                      API. The thumbnail strip below lets users canary-check
                      the chosen filter against any other image in the queue
                      without touching the network. */}
                  {showBatchPreview && batchPreviewItem && (
                    <div className="shrink-0 flex flex-col w-full">
                      <div className="flex items-center justify-between mb-1.5 px-1">
                        <div className="text-[11px] text-amber-300 inline-flex items-center gap-2">
                          <Layers className="w-3.5 h-3.5" />
                          Batch preview · sample {safeBatchPreviewIndex + 1} of {imageBatchItems.length}
                        </div>
                        <div className="text-[10px] text-zinc-500 hidden sm:block">
                          filter applied locally — no API calls
                        </div>
                      </div>

                      {/* Hero preview frame: large, edge-to-edge, isolated.
                          `relative` + `overflow-hidden` keeps the image (and
                          its CSS filter) strictly inside the rounded border —
                          nothing can spill onto the side panel or header. The
                          height clamp uses min() of (56vh, 560px) so on tall
                          screens the preview doesn't dwarf everything else,
                          and on short screens it still leaves room for the
                          batch settings below. */}
                      <div
                        className="relative w-full bg-black/40 rounded-lg border border-zinc-800 overflow-hidden flex items-center justify-center"
                        style={{ minHeight: 240, maxHeight: "min(56vh, 560px)" }}
                      >
                        <img
                          src={batchPreviewItem.dataUrl}
                          alt={batchPreviewItem.name}
                          className="block max-w-full max-h-full object-contain transition-all duration-200"
                          style={previewStyle}
                        />
                      </div>

                      {/* Thumbnail rail — full width of the preview frame, its
                          own row so it never visually overlaps the hero. When
                          there are more thumbs than fit, `overflow-x-auto`
                          gives a native horizontal scroll. */}
                      {imageBatchItems.length > 1 && (
                        <div className="w-full flex items-center gap-1.5 overflow-x-auto py-2">
                          {imageBatchItems.map((it, i) => {
                            const active = i === safeBatchPreviewIndex;
                            return (
                              <button
                                key={it.id}
                                type="button"
                                onClick={() => setBatchPreviewIndex(i)}
                                aria-label={`Preview ${it.name}`}
                                aria-pressed={active}
                                className={cn(
                                  "relative shrink-0 w-14 h-14 rounded-md overflow-hidden border-2 transition-all",
                                  active
                                    ? "border-amber-400 ring-2 ring-amber-400/30"
                                    : "border-zinc-700 hover:border-zinc-500",
                                )}
                              >
                                <img src={it.dataUrl} alt="" className="w-full h-full object-cover" />
                                {it.status === "completed" && (
                                  <span className="absolute inset-x-0 bottom-0 bg-emerald-500/85 text-white text-[8px] py-0.5 text-center font-semibold leading-none">
                                    DONE
                                  </span>
                                )}
                                {it.status === "failed" && (
                                  <span className="absolute inset-x-0 bottom-0 bg-red-500/85 text-white text-[8px] py-0.5 text-center font-semibold leading-none">
                                    FAIL
                                  </span>
                                )}
                                {(it.status === "uploading" || it.status === "processing") && (
                                  <span className="absolute inset-x-0 bottom-0 bg-amber-500/85 text-white text-[8px] py-0.5 text-center font-semibold leading-none">
                                    …
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  <Card className="border border-amber-500/30 bg-zinc-950/80 shrink-0 overflow-hidden">
                    <CardContent className="p-4 max-h-[60vh] overflow-y-auto">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Layers className="w-4 h-4 text-amber-400" />
                          <h3 className="text-sm font-semibold text-amber-200">Batch Studio</h3>
                          <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-300">
                            {batchItems.length} file{batchItems.length === 1 ? "" : "s"}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="file"
                            id="batch-add-more"
                            multiple
                            accept="image/*,video/*"
                            className="sr-only"
                            onChange={(e) => {
                              const files = Array.from(e.target.files ?? []);
                              if (files.length === 0) return;
                              Promise.all(
                                files.map(
                                  (f) =>
                                    new Promise<BatchItem>((resolve, reject) => {
                                      const reader = new FileReader();
                                      reader.onload = () =>
                                        resolve({
                                          id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                                          name: f.name,
                                          type: f.type,
                                          dataUrl: String(reader.result ?? ""),
                                          jobId: null,
                                          status: "queued",
                                        });
                                      reader.onerror = () => reject(new Error("read failed"));
                                      reader.readAsDataURL(f);
                                    }),
                                ),
                              )
                                .then((items) => setBatchItems((prev) => [...prev, ...items]))
                                .catch(() => {});
                              e.target.value = ""; // allow re-selecting the same files
                            }}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => document.getElementById("batch-add-more")?.click()}
                          >
                            <UploadCloud className="w-3 h-3 mr-1" />
                            Add files
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 text-xs bg-amber-500 hover:bg-amber-600 text-zinc-950 font-semibold"
                            disabled={isBatchProcessing || batchItems.length === 0}
                            onClick={handleBatchProcess}
                          >
                            {isBatchProcessing ? (
                              <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Processing…</>
                            ) : (
                              <>Process Batch ({batchItems.length})</>
                            )}
                          </Button>
                          {completedBatchCount > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
                              disabled={isDownloadingBatch}
                              onClick={handleBatchDownloadAll}
                            >
                              {isDownloadingBatch ? (
                                <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Zipping…</>
                              ) : (
                                <><Download className="w-3 h-3 mr-1" /> Download all ({completedBatchCount})</>
                              )}
                            </Button>
                          )}
                          {batchItems.length > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                              disabled={isBatchProcessing}
                              onClick={resetBatchSession}
                              title="Clear the queue and start a fresh batch (no reload)"
                            >
                              <RefreshCw className="w-3 h-3 mr-1" /> Start new batch
                            </Button>
                          )}
                        </div>
                      </div>
                      <p className="text-[11px] text-zinc-500 mb-2">
                        All files share the same enhancement, filter, and upscale settings.
                        Pick a filter below (or "No Filter") and click Process Batch. Progress shows per-file; results appear in History.
                      </p>

                      {/* ── Optional filter pre-selection ───────────────────────
                          Single source of truth: same `selectedFilter` state the
                          side panel and single-file flow already use. Picking a
                          chip here just toggles that state (`null` ↔ filterId);
                          it never auto-triggers Process Batch the way single-
                          file filter chips trigger handleProcess() — the user
                          still has to click "Process Batch" to start. */}
                      <div className="mb-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
                          Filter (optional)
                        </p>
                        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-0.5 px-0.5">
                          <button
                            type="button"
                            onClick={() => setSelectedFilter(null)}
                            aria-pressed={selectedFilter === null}
                            className={cn(
                              "shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] border transition-colors",
                              selectedFilter === null
                                ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-200"
                                : "bg-zinc-900/60 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600",
                            )}
                          >
                            <X className="w-3 h-3" />
                            No Filter
                          </button>
                          {FILTER_PRESETS.filter((p) => p.key !== "original").map((p) => {
                            const active = selectedFilter === p.key;
                            return (
                              <button
                                key={p.key}
                                type="button"
                                onClick={() => setSelectedFilter(p.key)}
                                aria-pressed={active}
                                className={cn(
                                  "shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] border transition-colors",
                                  active
                                    ? "bg-amber-500/15 border-amber-500/40 text-amber-200"
                                    : "bg-zinc-900/60 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600",
                                )}
                              >
                                <span
                                  className="w-3 h-3 rounded-full ring-1 ring-zinc-700"
                                  style={{ background: p.gradient }}
                                  aria-hidden
                                />
                                {p.name}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-[10px] text-zinc-500 mt-1.5">
                          Will apply:{" "}
                          <span className="text-zinc-300">
                            {getEnhancementMeta(enhancementType ?? "auto_face").label}
                          </span>
                          {" · "}
                          <span className={selectedFilter ? "text-amber-300" : "text-emerald-300"}>
                            {selectedFilter
                              ? (FILTER_PRESETS_BY_KEY.get(selectedFilter)?.name ?? selectedFilter)
                              : "No Filter"}
                          </span>
                          {upscaleAfter && (
                            <>
                              {" · "}
                              <span className="text-indigo-300">
                                {upscaleAfter === "upscale_4x" ? "4× Upscale" : "2× Upscale"}
                              </span>
                            </>
                          )}
                        </p>
                      </div>

                      <div
                        className="rounded-md border border-zinc-800 bg-zinc-950/60 max-h-[60vh] overflow-y-auto divide-y divide-zinc-900"
                        role="list"
                        aria-label="Batch queue"
                      >
                        {batchItems.length === 0 ? (
                          <div className="p-6 text-center text-xs text-zinc-500">
                            Drop or pick files to start a batch.
                          </div>
                        ) : (
                          batchItems.map((it) => (
                            <div
                              key={it.id}
                              role="listitem"
                              className="flex items-center gap-3 px-3 py-2 text-xs"
                            >
                              <div className="w-10 h-10 rounded bg-zinc-800 overflow-hidden shrink-0 flex items-center justify-center">
                                {it.type.startsWith("image/") ? (
                                  <img src={it.dataUrl} alt={it.name} className="w-full h-full object-cover" />
                                ) : (
                                  <Video className="w-4 h-4 text-zinc-500" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-zinc-200 truncate">{it.name}</p>
                                <p className="text-[10px] text-zinc-500">
                                  {it.type || (it.name.split(".").pop() ?? "file")}
                                </p>
                              </div>
                              <div className="shrink-0 flex items-center gap-2">
                                {it.status === "queued" && (
                                  <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">Queued</Badge>
                                )}
                                {it.status === "uploading" && (
                                  <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-300 inline-flex items-center gap-1">
                                    <Loader2 className="w-3 h-3 animate-spin" /> Uploading
                                  </Badge>
                                )}
                                {it.status === "processing" && (
                                  <Badge variant="outline" className="text-[10px] border-cyan-500/40 text-cyan-300 inline-flex items-center gap-1">
                                    <Loader2 className="w-3 h-3 animate-spin" /> Processing
                                  </Badge>
                                )}
                                {it.status === "completed" && (
                                  <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300 inline-flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" /> Done
                                  </Badge>
                                )}
                                {it.status === "failed" && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-300 inline-flex items-center gap-1 cursor-help">
                                        <AlertCircle className="w-3 h-3" /> Failed
                                      </Badge>
                                    </TooltipTrigger>
                                    {it.error && (
                                      <TooltipContent side="left" className="text-xs max-w-[240px]">
                                        {it.error}
                                      </TooltipContent>
                                    )}
                                  </Tooltip>
                                )}
                                {it.status === "queued" && (
                                  <button
                                    type="button"
                                    aria-label={`Remove ${it.name}`}
                                    className="text-zinc-500 hover:text-red-400 transition-colors"
                                    onClick={() => removeBatchItem(it.id)}
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ) : !file ? (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-lg w-full space-y-4">
                  <Card className="border-dashed border-2 border-zinc-800 bg-zinc-950/50 hover:bg-zinc-900/50 hover:border-zinc-700 transition-all cursor-pointer relative overflow-hidden group">
                    <input type="file" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      accept={studioMode === "video" ? "video/*" : "image/*"} onChange={handleFileChange} />
                    <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                      <motion.div
                        animate={{ y: [0, -6, 0] }}
                        transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                        className="w-20 h-20 bg-gradient-to-br from-teal-500/20 to-cyan-500/20 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform"
                      >
                        <UploadCloud className="w-10 h-10 text-teal-400" />
                      </motion.div>
                      <h3 className="text-xl font-bold mb-2">{studioMode === "video" ? "Upload Video" : "Upload Photo"}</h3>
                      <p className="text-zinc-500 text-sm mb-1">Drag &amp; drop or click to browse</p>
                      <p className="text-zinc-600 text-xs mb-6">{studioMode === "video" ? "AI will stabilize, color grade, and enhance your video" : "AI will analyze and suggest the best enhancement"}</p>
                      <div className="flex items-center gap-6 text-xs text-zinc-600">
                        {studioMode === "photo" && <span className="flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5" /> Photos up to {MAX_FILE_MB} MB</span>}
                        {studioMode === "video" && <span className="flex items-center gap-1.5"><Video className="w-3.5 h-3.5" /> Videos up to {MAX_FILE_MB} MB</span>}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Video Studio roadmap — only shown on the empty-state of
                      Video Studio. Sets clear expectations: what's live now,
                      what's queued next, what's still being researched.
                      Helps users understand the gap between Photo Studio and
                      Video Studio without surprise. */}
                  {studioMode === "video" && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.15 }}
                      className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4"
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <Film className="w-4 h-4 text-purple-300" />
                        <h4 className="text-sm font-semibold text-zinc-100">Video Studio — what's available now</h4>
                        <span className="ml-auto inline-flex items-center rounded-full border border-purple-500/40 bg-purple-500/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-purple-200">
                          Expanding
                        </span>
                      </div>
                      <ul className="space-y-1.5">
                        {VIDEO_ROADMAP.map((item) => (
                          <li key={item.title} className="flex items-start gap-2 text-xs">
                            {item.status === "live" ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                            ) : item.status === "next" ? (
                              <Clock className="w-3.5 h-3.5 text-amber-300 shrink-0 mt-0.5" />
                            ) : (
                              <Sparkles className="w-3.5 h-3.5 text-zinc-500 shrink-0 mt-0.5" />
                            )}
                            <div>
                              <span className={cn(
                                "font-medium",
                                item.status === "live" ? "text-zinc-100"
                                  : item.status === "next" ? "text-amber-100"
                                  : "text-zinc-400",
                              )}>
                                {item.title}
                              </span>
                              <span className={cn(
                                "ml-2 text-[10px] uppercase tracking-wider",
                                item.status === "live" ? "text-emerald-400"
                                  : item.status === "next" ? "text-amber-300"
                                  : "text-zinc-500",
                              )}>
                                {item.status === "live" ? "Live" : item.status === "next" ? "Coming next" : "Exploring"}
                              </span>
                              <p className="text-[11px] text-zinc-500 leading-relaxed">{item.blurb}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-3 text-[10px] text-zinc-500 border-t border-zinc-800 pt-2">
                        Photo Studio is at full feature parity today. Video features ship in waves —
                        send a note via the Feedback button (bottom-left) to vote on what we ship next.
                      </p>
                    </motion.div>
                  )}
                </motion.div>
              ) : (
                <div className="w-full h-full flex flex-col min-h-0 gap-2">
                  {/* Top toolbar — in-flow so it reserves space (no overlap with tall images) */}
                  <div className="w-full flex items-center justify-between gap-2 shrink-0 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={resetAll}
                        className="bg-black/50 backdrop-blur border-white/10 hover:bg-white/10 text-xs h-8">
                        <RefreshCw className="w-3.5 h-3.5 mr-1.5" />New
                      </Button>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="outline" size="sm" onClick={handleUndo} disabled={undoStack.length === 0}
                            className="bg-black/50 backdrop-blur border-white/10 hover:bg-white/10 text-xs h-8 gap-1.5 disabled:opacity-30">
                            <Undo2 className="w-3.5 h-3.5" />
                            {undoStack.length > 0 && <span className="text-[10px] text-zinc-500">{undoStack.length}</span>}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Undo ({undoStack.length} steps)</TooltipContent>
                      </Tooltip>
                      {/* Persistent Upscale shortcut (dashboard-redesign S3) */}
                      {studioMode === "photo" && file && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-stretch rounded-md overflow-hidden border border-teal-500/40 bg-black/50 backdrop-blur h-8">
                              <button
                                type="button"
                                disabled={isProcessing}
                                onClick={() => {
                                  setEnhancementType("upscale");
                                  toast({ title: "Upscale 2× selected", description: "Click Enhance to apply." });
                                }}
                                className={cn(
                                  "px-2.5 text-xs font-medium transition-colors disabled:opacity-40 flex items-center gap-1.5",
                                  enhancementType === "upscale"
                                    ? "bg-teal-500/20 text-teal-200"
                                    : "text-teal-300 hover:bg-teal-500/10",
                                )}
                                aria-label="Quick select 2× upscale"
                              >
                                <ZoomIn className="w-3.5 h-3.5" />
                                2×
                              </button>
                              <div className="w-px bg-teal-500/30" aria-hidden />
                              <button
                                type="button"
                                disabled={isProcessing}
                                onClick={() => {
                                  setEnhancementType("upscale_4x");
                                  toast({ title: "Upscale 4× selected", description: "Click Enhance to apply." });
                                }}
                                className={cn(
                                  "px-2.5 text-xs font-medium transition-colors disabled:opacity-40 flex items-center gap-1.5",
                                  enhancementType === "upscale_4x"
                                    ? "bg-teal-500/20 text-teal-200"
                                    : "text-teal-300 hover:bg-teal-500/10",
                                )}
                                aria-label="Quick select 4× upscale"
                              >
                                <Layers className="w-3.5 h-3.5" />
                                4×
                              </button>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>Quick select Upscale — click Enhance to apply</TooltipContent>
                        </Tooltip>
                      )}
                      {/* AI chat toggle moved to floating button */}
                      {isCompleted && (
                        <Button variant="outline" size="sm"
                          className={cn("bg-black/50 backdrop-blur border-white/10 hover:bg-white/10 text-xs h-8", showCompare && "border-teal-500 text-teal-300")}
                          onMouseDown={() => setShowCompare(true)}
                          onMouseUp={() => setShowCompare(false)}
                          onMouseLeave={() => setShowCompare(false)}
                          onTouchStart={() => setShowCompare(true)}
                          onTouchEnd={() => setShowCompare(false)}
                        >
                          <Eye className="w-3.5 h-3.5 mr-1.5" />Hold to compare
                        </Button>
                      )}
                      {isCompleted && currentJob?.processedUrl && (
                        <Button variant="outline" size="sm"
                          className={cn("bg-black/50 backdrop-blur border-white/10 hover:bg-white/10 text-xs h-8", splitCompare && "border-teal-500 text-teal-300")}
                          onClick={() => setSplitCompare(!splitCompare)}
                        >
                          <ArrowLeftRight className="w-3.5 h-3.5 mr-1.5" />Side-by-Side
                        </Button>
                      )}
                    </div>
                    {isCompleted && currentJob?.processedUrl ? (
                      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="sm" className="bg-white text-black hover:bg-white/90 shadow-lg h-9 px-5 font-semibold text-sm" onClick={handleExport}>
                              <Download className="w-4 h-4 mr-2" />Export
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            <span className="text-xs">Save enhanced image <kbd className="ml-1 px-1 py-0.5 rounded bg-zinc-700 text-[10px]">⌘S</kbd></span>
                          </TooltipContent>
                        </Tooltip>
                      </motion.div>
                    ) : file && !isProcessing ? (
                      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="sm" variant="outline"
                              className="border-teal-500/50 text-teal-300 hover:bg-teal-500/10 h-9 px-4 text-sm font-semibold"
                              onClick={handleProcessAndExport}
                            >
                              <Zap className="w-4 h-4 mr-2" />Enhance &amp; Export
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            <span className="text-xs">Process enhancement then download <kbd className="ml-1 px-1 py-0.5 rounded bg-zinc-700 text-[10px]">⌘S</kbd></span>
                          </TooltipContent>
                        </Tooltip>
                      </motion.div>
                    ) : null}
                  </div>

                  <div className="w-full max-w-[70rem] mx-auto flex flex-col flex-1 min-h-0 gap-2">
                    {/* Image preview — fills remaining vertical space, fits any aspect ratio */}
                    <div className="relative flex-1 min-h-0 w-full rounded-xl overflow-hidden border border-white/10 shadow-2xl bg-black flex items-center justify-center">
                      <AnimatePresence>
                        {isProcessing && (
                          <motion.div
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center z-20 rounded-xl"
                          >
                            <motion.div
                              animate={{ rotate: 360 }}
                              transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                            >
                              <Sparkles className="w-12 h-12 text-teal-500 mb-4" />
                            </motion.div>
                            <p className="text-lg font-semibold">{processStage === "uploading" ? "Uploading..." : (upscaleChainRef.current ? "Upscaling Image..." : "Applying AI Magic...")}</p>
                            <p className="text-sm text-zinc-400 mt-1">This may take a few moments</p>
                            <div className="mt-4 w-48 h-1 bg-zinc-800 rounded-full overflow-hidden">
                              <motion.div
                                className="h-full bg-gradient-to-r from-teal-500 to-cyan-500 rounded-full"
                                animate={{ x: ["-100%", "100%"] }}
                                transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                                style={{ width: "60%" }}
                              />
                            </div>
                          </motion.div>
                        )}
                        {/* AI scan overlay — animated line sweeps over image during analysis */}
                        {isAnalyzing && !isProcessing && (
                          <motion.div
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="absolute inset-0 z-20 pointer-events-none rounded-xl"
                          >
                            {/* Scan line */}
                            <motion.div
                              className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-teal-400 to-transparent shadow-[0_0_12px_4px_rgba(20,184,166,0.4)]"
                              animate={{ top: ["0%", "100%", "0%"] }}
                              transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut" }}
                            />
                            {/* Corner brackets */}
                            <div className="absolute top-2 left-2 w-5 h-5 border-t-2 border-l-2 border-teal-400/60 rounded-tl" />
                            <div className="absolute top-2 right-2 w-5 h-5 border-t-2 border-r-2 border-teal-400/60 rounded-tr" />
                            <div className="absolute bottom-2 left-2 w-5 h-5 border-b-2 border-l-2 border-teal-400/60 rounded-bl" />
                            <div className="absolute bottom-2 right-2 w-5 h-5 border-b-2 border-r-2 border-teal-400/60 rounded-br" />
                            {/* Label */}
                            <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-black/70 backdrop-blur px-3 py-1 rounded-full">
                              <ScanEye className="w-3 h-3 text-teal-400" />
                              <span className="text-[10px] font-medium text-teal-300">AI Scanning</span>
                              <Loader2 className="w-2.5 h-2.5 text-teal-400 animate-spin" />
                            </div>
                          </motion.div>
                        )}
                        {isRenderingPreview && canonicalPreviewUrl && !isProcessing && (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute top-3 right-3 z-20 rounded-full bg-black/70 px-3 py-1 text-[10px] font-medium text-teal-300 backdrop-blur"
                          >
                            Refreshing preview...
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {splitCompare && isCompleted && currentJob?.processedUrl ? (
                        <div className="grid grid-cols-2 gap-3 w-full h-full min-h-0">
                          <div className="flex flex-col min-h-0 gap-1">
                            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider shrink-0">Original</span>
                            <div className="rounded-lg border border-zinc-800 overflow-hidden bg-zinc-900 flex items-center justify-center flex-1 min-h-0">
                              {mediaType === "video"
                                ? <video src={previewUrl} controls className="max-w-full max-h-full object-contain" />
                                : <img src={previewUrl} alt="Original" className="max-w-full max-h-full object-contain select-none touch-none" draggable={false} {...panHandlers} style={{ transform: zoomTransform, transformOrigin: "center", transition: zoomTransition, cursor: panCursor }} />}
                            </div>
                          </div>
                          <div className="flex flex-col min-h-0 gap-1">
                            <span className="text-[10px] font-medium text-teal-400 uppercase tracking-wider shrink-0">Enhanced</span>
                            <div className="rounded-lg border border-teal-500/30 overflow-hidden bg-zinc-900 flex items-center justify-center flex-1 min-h-0">
                              {mediaType === "video"
                                ? <video src={currentJob.processedUrl} controls autoPlay loop muted className="max-w-full max-h-full object-contain" />
                                : <img src={currentJob.processedUrl} alt="Enhanced" className="max-w-full max-h-full object-contain select-none touch-none" draggable={false} {...panHandlers} style={{ transform: zoomTransform, transformOrigin: "center", transition: zoomTransition, cursor: panCursor }} />}
                            </div>
                          </div>
                        </div>
                      ) : isCompleted && currentJob?.processedUrl && !showCompare ? (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-center max-h-full">
                          {mediaType === "video"
                            ? <video src={currentJob.processedUrl} controls autoPlay loop muted className="max-w-full max-h-full object-contain" />
                            : <img src={currentJob.processedUrl} alt="Enhanced" className="max-w-full max-h-full object-contain select-none touch-none" draggable={false} {...panHandlers} style={{ transform: zoomTransform, transformOrigin: "center", transition: zoomTransition, cursor: panCursor }} />
                          }
                        </motion.div>
                      ) : (
                        mediaType === "video"
                          ? <video src={previewUrl} controls className="max-w-full max-h-full object-contain" />
                          : <div className="flex items-center justify-center max-h-full">
                              <img src={livePreviewSrc} alt="Preview"
                                className="max-w-full max-h-full object-contain transition-all duration-200 select-none touch-none"
                                draggable={false}
                                {...panHandlers}
                                style={canonicalPreviewUrl && !isProcessing
                                  ? { transform: zoomTransform, transformOrigin: "center", transition: zoomTransition, cursor: panCursor }
                                  : { ...(isProcessing ? { opacity: 0.5 } : previewStyle), transform: zoomTransform, transformOrigin: "center", transition: zoomTransition, cursor: panCursor }} />
                            </div>
                      )}
                    </div>

                    {/* Zoom controls */}
                    {mediaType !== "video" && (
                      <div className="flex items-center justify-center gap-2 mt-1 shrink-0">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-400 hover:text-white" onClick={zoomOut} disabled={zoomLevel <= 0.25}>
                          <ZoomOut className="w-3.5 h-3.5" />
                        </Button>
                        <button onClick={zoomReset} className="text-[10px] text-zinc-500 hover:text-zinc-300 min-w-[40px] text-center tabular-nums" title={canPan ? "Reset zoom & pan" : "Reset zoom"}>
                          {Math.round(zoomLevel * 100)}%
                        </button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-400 hover:text-white" onClick={zoomIn} disabled={zoomLevel >= 4}>
                          <ZoomIn className="w-3.5 h-3.5" />
                        </Button>
                        {canPan && (
                          <span className="text-[10px] text-zinc-500 ml-2 inline-flex items-center gap-1" aria-live="polite">
                            <ArrowLeftRight className="w-3 h-3" />
                            Drag to pan
                          </span>
                        )}
                      </div>
                    )}

                    {/* Filter Gallery — applied after the primary enhancement.
                        For video, the sidecar maps known filters to a built-in
                        color_grade and approximates unmapped ones per-frame.
                        Filter chips toggle the local CSS preview only — users
                        can flip through filters and compare freely without
                        triggering an API call. The filter is committed to the
                        actual enhancement chain when the user clicks
                        "Enhance Media". Undo (⌘Z) reverts filter changes. */}
                    {(
                      <div id="workflow-step-filter" className="w-full shrink-0 space-y-1.5 scroll-mt-4">
                        <div className="flex items-center justify-between px-0.5">
                          <Label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">2. Filter — preview, then enhance to apply</Label>
                          {mediaType === "video" && (
                            <span className="text-[10px] text-amber-400 ml-2">Approximate filter on video</span>
                          )}
                          {selectedFilter && (
                            <span className="text-[10px] text-teal-400 truncate ml-2">Previewing: {selectedFilter}</span>
                          )}
                        </div>
                        <p className="text-[10px] text-zinc-500 px-0.5 leading-snug">
                          Tap filters to compare instantly. Use <span className="text-zinc-300">Undo (⌘Z)</span> to flip back. Click <span className="text-teal-300">Enhance Media</span> when you've picked the look you want.
                        </p>
                        <div
                          role="list"
                          aria-label="Filter gallery"
                          className="flex flex-wrap items-start gap-2 overflow-hidden pb-0.5"
                        >
                          {FILTER_PRESETS.map((p) => {
                            const filterLocked = isFeatureLocked("filter", p.key);
                            return (
                              <Tooltip key={p.key}>
                                <TooltipTrigger asChild>
                                  <motion.button
                                    whileTap={{ scale: 0.95 }}
                                    role="listitem"
                                    aria-label={`Apply ${p.name} filter${filterLocked ? " (Premium)" : p.premium ? " (Premium available)" : ""}`}
                                    aria-pressed={selectedFilter === p.key}
                                    className={cn(
                                      "relative snap-start rounded-md border transition-all overflow-hidden w-[64px] sm:w-[68px] shrink-0 h-[52px] sm:h-[58px] group focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-900",
                                      filterLocked
                                        ? "border-zinc-800 opacity-50 cursor-not-allowed"
                                        : selectedFilter === p.key ? "border-teal-500 ring-1 ring-teal-500/30" : "border-zinc-800 hover:border-zinc-500",
                                    )}
                                    onClick={() => {
                                      if (filterLocked) {
                                        toast({ title: "Premium filter", description: `Upgrade to Premium to unlock the ${p.name} filter.`, variant: "destructive" });
                                        return;
                                      }
                                      pushUndo();
                                      setSelectedFilter(p.key === "original" ? null : p.key);
                                      // PREVIEW-ONLY: filter chips drive the local CSS preview
                                      // (`previewStyle`) so users can toggle and compare freely
                                      // without triggering an API call. The chosen filter is
                                      // committed to the enhancement chain on the next
                                      // "Enhance Media" click. We deliberately do NOT call
                                      // setEnhancementType("filter") here — the
                                      // /media/enhance-chain endpoint runs the user's chosen
                                      // enhancement (e.g. auto_face) AND the filter on top of
                                      // it as a single chained job.
                                    }}
                                  >
                                    <div className={cn("absolute inset-0 bg-gradient-to-br opacity-60", p.gradient)} />
                                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1 py-0.5">
                                      <span className="text-[10px] font-medium text-white drop-shadow leading-tight block truncate">{p.name}</span>
                                    </div>
                                    {filterLocked ? (
                                      <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-amber-500/90 flex items-center justify-center">
                                        <Lock className="w-2.5 h-2.5 text-zinc-900 z-30" />
                                      </div>
                                    ) : p.premium && (
                                      <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-400" />
                                    )}
                                    {selectedFilter === p.key && (
                                      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute top-1 left-1">
                                        <CheckCircle2 className="w-3 h-3 text-teal-400" />
                                      </motion.div>
                                    )}
                                  </motion.button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                  {p.name}{filterLocked ? " 🔒 Premium" : p.premium ? " (Premium)" : ""}
                                </TooltipContent>
                              </Tooltip>
                            );
                          })}
                        </div>

                        {/* Step 3: Also Upscale — visible in both Simple and Advanced photo modes */}
                        {enhancementType !== "upscale" && enhancementType !== "upscale_4x" && enhancementType !== "esrgan_upscale_2x" && enhancementType !== "esrgan_upscale_4x" && (
                          <div id="workflow-step-upscale" className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-2.5 py-1.5 flex items-center justify-between scroll-mt-4">
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-zinc-800 text-[9px] font-bold text-zinc-300">3</span>
                              <ZoomIn className="w-3.5 h-3.5 text-cyan-400" />
                              <Label className="text-[11px] font-medium text-zinc-300">Also Upscale</Label>
                              {upscaleAfter && (
                                <div className="flex gap-1 ml-1">
                                  <button
                                    className={cn(
                                      "text-[10px] py-0.5 px-1.5 rounded border transition-all font-medium",
                                      upscaleAfter === "upscale"
                                        ? "border-cyan-500 bg-cyan-500/10 text-cyan-300"
                                        : "border-zinc-700 text-zinc-500 hover:border-zinc-600",
                                    )}
                                    onClick={() => setUpscaleAfter("upscale")}
                                  >2x</button>
                                  <button
                                    className={cn(
                                      "text-[10px] py-0.5 px-1.5 rounded border transition-all font-medium",
                                      isFeatureLocked("upscale_4x") ? "opacity-40 cursor-not-allowed border-zinc-700 text-zinc-600" :
                                      upscaleAfter === "upscale_4x"
                                        ? "border-cyan-500 bg-cyan-500/10 text-cyan-300"
                                        : "border-zinc-700 text-zinc-500 hover:border-zinc-600",
                                    )}
                                    onClick={() => {
                                      if (isFeatureLocked("upscale_4x")) {
                                        toast({ title: "Premium feature", description: "Upgrade to Premium to unlock 4x upscaling.", variant: "destructive" });
                                        return;
                                      }
                                      setUpscaleAfter("upscale_4x");
                                    }}
                                  >4x{isFeatureLocked("upscale_4x") && <Lock className="w-2.5 h-2.5 inline ml-0.5" />}</button>
                                </div>
                              )}
                            </div>
                            <Switch
                              checked={upscaleAfter !== null}
                              onCheckedChange={(checked) => setUpscaleAfter(checked ? "upscale" : null)}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Bottom info bar */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                      <span className="truncate max-w-[200px]">{file.name}</span>
                      <span>&#8226;</span>
                      <span>{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                      <span>&#8226;</span>
                      <Badge variant="outline" className="text-[9px] border-zinc-700 text-zinc-400 px-1 py-0 h-4">
                        {editorMode === "simple" ? "Simple" : "Advanced"}
                      </Badge>
                      {hasEdits && <><span>&#8226;</span><span className="text-teal-400">Edits staged</span></>}
                      {selectedFilter && <><span>&#8226;</span><span className="text-teal-400">Filter: {selectedFilter}</span></>}
                      {isRenderingPreview && <><span>&#8226;</span><span className="text-cyan-400">Refreshing preview</span></>}
                      {isCompleted && (
                        <><span>&#8226;</span>
                        <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-teal-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />Enhanced
                        </motion.span></>
                      )}
                      {showCompare && <><span>&#8226;</span><span className="text-amber-400">Showing original</span></>}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Post-enhancement upgrade promo — surfaces ONLY for non-premium
                users on a completed job. Promotes the upgrade path at the
                exact moment the user has just experienced value, without
                interrupting the editing flow before completion. */}
            {isCompleted && !canAccessPremium && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 max-w-2xl w-[calc(100%-2rem)]"
              >
                <div className="rounded-lg border border-amber-500/40 bg-zinc-950/95 backdrop-blur px-4 py-3 shadow-lg">
                  <div className="flex items-start gap-3 flex-wrap">
                    <Crown className="w-4 h-4 text-amber-300 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-zinc-100 font-medium">
                        Like the result? Unlock 4× upscaling, batch processing, and premium filters.
                      </div>
                      <div className="text-[11px] text-zinc-400 mt-0.5">
                        Premium plans start at affordable rates. Or grab a one-time credit pack — no subscription needed.
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        className="h-7 text-xs bg-amber-500 hover:bg-amber-600 text-zinc-950 font-semibold"
                        onClick={() => { window.location.href = "/pricing"; }}
                      >
                        View plans
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-fuchsia-500/50 text-fuchsia-300 hover:bg-fuchsia-500/10"
                        onClick={() => { window.location.href = "/billing"; }}
                      >
                        Buy credits
                      </Button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </main>

          {/* Floating AI Chat — bottom-right.
              Available to ALL users. Chat replies use the friendly enhancement
              label (e.g. "Auto Face") rather than internal type keys, and the
              technical model identity is reserved for admins who pay attention
              to model routing. */}
          <AnimatePresence>
            {showAiChat && (
              <motion.div
                initial={{ opacity: 0, y: 24, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 24, scale: 0.95 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                className="fixed bottom-20 right-4 w-80 h-[480px] bg-zinc-950/95 backdrop-blur-lg border border-white/10 rounded-2xl flex flex-col z-50 shadow-2xl shadow-black/60"
              >
                {/* Chat header */}
                <div className="p-4 border-b border-white/10 flex items-center justify-between shrink-0 rounded-t-2xl">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-teal-500/20 flex items-center justify-center">
                      <Sparkles className="w-3.5 h-3.5 text-teal-400" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">AI Assistant</p>
                      <p className="text-[10px] text-zinc-500">Powered by GlimpseAI</p>
                    </div>
                  </div>
                  <button onClick={() => setShowAiChat(false)} className="text-zinc-600 hover:text-zinc-300 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Messages */}
                <ScrollArea className="flex-1 p-4">
                  <div className="space-y-3">
                    {isAnalyzing && chatMessages.length === 0 && (
                      <div className="flex items-start gap-2">
                        <div className="w-6 h-6 rounded-full bg-teal-500/20 flex items-center justify-center shrink-0 mt-0.5">
                          <Loader2 className="w-3 h-3 text-teal-400 animate-spin" />
                        </div>
                        <div className="bg-zinc-900 border border-zinc-800 rounded-xl rounded-tl-none px-3 py-2 text-xs text-zinc-400">
                          Analyzing your image...
                        </div>
                      </div>
                    )}
                    {chatMessages.map((msg) => (
                      <div key={msg.id} className={cn("flex items-start gap-2", msg.role === "user" && "flex-row-reverse")}>
                        <div className={cn(
                          "w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold",
                          msg.role === "ai" ? "bg-teal-500/20 text-teal-400" : "bg-cyan-500/20 text-cyan-400"
                        )}>
                          {msg.role === "ai" ? <Sparkles className="w-3 h-3" /> : "U"}
                        </div>
                        <div className={cn(
                          "max-w-[220px] rounded-xl px-3 py-2 text-xs leading-relaxed",
                          msg.role === "ai"
                            ? "bg-zinc-900 border border-zinc-800 rounded-tl-none text-zinc-300"
                            : "bg-teal-600/20 border border-teal-500/20 rounded-tr-none text-teal-100"
                        )}>
                          <p className="whitespace-pre-line">{msg.text}</p>
                          {msg.action && !msg.applied && msg.role === "ai" && (() => {
                            // Resolve raw type/filter keys to friendly display labels
                            // so the chat surface never leaks internal identifiers.
                            const actionLabel = getEnhancementMeta(msg.action.type).label;
                            const actionFilter = msg.action.filter
                              ? FILTER_PRESETS.find((p) => p.key === msg.action!.filter || p.serverFilter === msg.action!.filter)?.name ?? msg.action.filter
                              : null;
                            return (
                            <div className="mt-2 pt-2 border-t border-white/5 space-y-1.5">
                              <p className="text-[10px] text-zinc-500">
                                Suggested: <span className="text-teal-300">{actionLabel}</span>
                                {actionFilter && <> · <span className="text-amber-300">{actionFilter}</span></>}
                              </p>
                              <Button
                                size="sm"
                                className="w-full h-6 text-[10px] bg-teal-600 hover:bg-teal-700 text-white"
                                onClick={() => {
                                  applyAiSuggestion();
                                }}
                              >
                                <Sparkles className="w-2.5 h-2.5 mr-1" />Apply
                              </Button>
                            </div>
                            );
                          })()}
                          {msg.applied && msg.role === "ai" && (
                            <div className="mt-1.5 flex items-center gap-1 text-[9px] text-emerald-400">
                              <CheckCircle2 className="w-2.5 h-2.5" />Applied
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {chatMessages.length === 0 && !isAnalyzing && (
                      <div className="text-center py-8 space-y-2">
                        <Sparkles className="w-8 h-8 text-teal-500/40 mx-auto" />
                        <p className="text-zinc-500 text-xs">Hi! I'm your AI editing assistant.</p>
                        <p className="text-zinc-600 text-[10px]">Upload a photo to get personalized recommendations, or ask me anything.</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>

                {/* Chat input */}
                <div className="p-3 border-t border-white/10 shrink-0 rounded-b-2xl">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const txt = chatInput.trim();
                      if (!txt) return;
                      const userId = ++chatIdRef.current;
                      setChatMessages(prev => [...prev, { id: userId, role: "user", text: txt }]);
                      setChatInput("");
                      const lower = txt.toLowerCase();
                      // Context-aware auto-reply with NLP pattern matching
                      setTimeout(() => {
                        const replyId = ++chatIdRef.current;
                        const imageType = aiSuggestion ? inferImageType(aiSuggestion.detectedSubjects) : null;
                        const confidencePct = aiSuggestion ? Math.round(aiSuggestion.confidence * 100) : 0;

                        // Greetings
                        if (/^(hi|hello|hey|howdy|sup|what'?s up|how are you|good (morning|afternoon|evening)|yo\b)/i.test(lower)) {
                          setChatMessages(prev => [...prev, {
                            id: replyId,
                            role: "ai",
                            text: file
                              ? `Hey! 👋 I've ${aiSuggestion ? `analyzed your ${imageType} image and I'm ${confidencePct}% confident about my recommendation. Want me to apply it?` : "already started analyzing your image. I'll have a recommendation shortly!"}`
                              : "Hi there! 👋 I'm your GlimpseAI assistant. Upload a photo and I'll find the perfect enhancement for it!",
                          }]);
                        // Help/capabilities
                        } else if (/^(help|what can you|how do|guide|tutorial|features|capabilities)/i.test(lower)) {
                          setChatMessages(prev => [...prev, {
                            id: replyId,
                            role: "ai",
                            text: "Here's what I can do:\n\n✨ Auto-analyze images for the best enhancement\n🎨 Suggest filters & color grades based on content\n📐 Upscale to 2x or 4x resolution\n👤 Portrait retouching & skin smoothing\n🎬 Cinematic color grading\n💡 Fix lighting issues\n🔄 Combine enhancements (enhance + upscale)\n\nJust upload a photo to get started!",
                          }]);
                        // Upscale/resolution
                        } else if (/upscale|scale|resolution|enlarge|bigger|sharper|hd|high.?res/i.test(lower)) {
                          const wants4x = /4x|quad|maximum|highest|best quality/i.test(lower);
                          setChatMessages(prev => [...prev, {
                            id: replyId,
                            role: "ai",
                            text: file
                              ? `I can ${wants4x ? "quadruple (4x)" : "double (2x)"} your image resolution using AI upscaling. ${upscaleAfter ? "You already have upscaling queued — it will run after your primary enhancement!" : "You can also combine this with other enhancements using the 'Also Upscale' toggle."}`
                              : "Upload an image first, then I can upscale it to 2x or 4x resolution!",
                            ...(file ? { action: { type: (wants4x ? "upscale_4x" : "upscale") as EnhanceMediaBodyEnhancementType } } : {}),
                          }]);
                        // Portrait/face/skin
                        } else if (/portrait|face|skin|retouch|smooth|beauty|selfie|headshot/i.test(lower)) {
                          setChatMessages(prev => [...prev, {
                            id: replyId,
                            role: "ai",
                            text: file
                              ? `${imageType === "portrait" ? "Great eye! This is a portrait, so " : ""}I recommend Portrait Polish — it naturally smooths skin, warms tones, and enhances facial features. ${aiSuggestion?.suggestedEnhancement === "portrait" ? `My AI analysis agrees with ${confidencePct}% confidence!` : ""}`
                              : "Upload a portrait and I'll optimize it with natural skin smoothing and warm tones!",
                            ...(file ? { action: { type: "portrait" as EnhanceMediaBodyEnhancementType } } : {}),
                          }]);
                        // Cinematic/film/movie
                        } else if (/cinematic|movie|film|color.?grade|hollywood|dramatic/i.test(lower)) {
                          setChatMessages(prev => [...prev, {
                            id: replyId,
                            role: "ai",
                            text: file
                              ? "Cinematic Grade applies film-grade color treatment — think moody shadows, lifted highlights, and rich tonal depth. Perfect for creating that professional film look."
                              : "Upload an image and I'll give it that blockbuster cinematic treatment!",
                            ...(file ? { action: { type: "color_grade_cinematic" as EnhanceMediaBodyEnhancementType } } : {}),
                          }]);
                        // Lighting
                        } else if (/light(ing)?|dark|bright|shadow|expose|underexposed|overexposed|dim/i.test(lower)) {
                          setChatMessages(prev => [...prev, {
                            id: replyId,
                            role: "ai",
                            text: file
                              ? "Fix Lighting uses mood-aware algorithms to recover shadows and tame highlights. It's especially effective for underexposed or harsh-lighting shots."
                              : "Upload a photo with lighting issues and I'll fix them!",
                            ...(file ? { action: { type: "lighting_enhance" as EnhanceMediaBodyEnhancementType } } : {}),
                          }]);
                        // Warm/cool tones
                        } else if (/warm|golden|cozy|sunset|cool|cold|blue|icy/i.test(lower)) {
                          const isWarm = /warm|golden|cozy|sunset/i.test(lower);
                          setChatMessages(prev => [...prev, {
                            id: replyId,
                            role: "ai",
                            text: file
                              ? `${isWarm ? "Warm Tones adds golden, inviting warmth — great for portraits and lifestyle shots." : "Cool Tones shifts to crisp, blue-shift palette — perfect for modern and minimalist looks."}`
                              : `Upload an image and I'll apply ${isWarm ? "warm, golden" : "cool, crisp"} tones!`,
                            ...(file ? { action: { type: (isWarm ? "color_grade_warm" : "color_grade_cool") as EnhanceMediaBodyEnhancementType } } : {}),
                          }]);
                        // Background blur/bokeh
                        } else if (/blur|bokeh|background|depth|focus|defocus/i.test(lower)) {
                          setChatMessages(prev => [...prev, {
                            id: replyId,
                            role: "ai",
                            text: file
                              ? "Background Blur creates intelligent portrait bokeh — it detects the subject and blurs the background naturally, simulating a shallow depth of field."
                              : "Upload a photo and I'll add professional background blur!",
                            ...(file ? { action: { type: "blur_background" as EnhanceMediaBodyEnhancementType } } : {}),
                          }]);
                        // What should I do / best / recommend
                        } else if (/what.*(should|do|recommend|suggest|best)|which.*(enhancement|filter|effect)/i.test(lower)) {
                          if (aiSuggestion) {
                            const friendlyEnhancement = getEnhancementMeta(aiSuggestion.suggestedEnhancement as EnhanceMediaBodyEnhancementType).label;
                            const friendlyFilter = aiSuggestion.suggestedFilter
                              ? FILTER_PRESETS.find((p) => p.key === aiSuggestion.suggestedFilter || p.serverFilter === aiSuggestion.suggestedFilter)?.name ?? aiSuggestion.suggestedFilter
                              : null;
                            setChatMessages(prev => [...prev, {
                              id: replyId,
                              role: "ai",
                              text: `Based on my analysis of your ${imageType} image, I recommend "${friendlyEnhancement}"${friendlyFilter ? ` with the ${friendlyFilter} filter` : ""}. I'm ${confidencePct}% confident this will give you the best results. ${aiSuggestion.description}`,
                              action: {
                                type: aiSuggestion.suggestedEnhancement as EnhanceMediaBodyEnhancementType,
                                filter: aiSuggestion.suggestedFilter ?? undefined,
                              },
                            }]);
                          } else if (file) {
                            setChatMessages(prev => [...prev, {
                              id: replyId,
                              role: "ai",
                              text: "I'm still analyzing your image. Hold tight — I'll have a personalized recommendation in a moment!",
                            }]);
                          } else {
                            setChatMessages(prev => [...prev, {
                              id: replyId,
                              role: "ai",
                              text: "Upload an image first! I'll analyze it and tell you exactly which enhancement will work best.",
                            }]);
                          }
                        // Thanks / positive feedback
                        } else if (/thanks|thank you|thx|awesome|great|perfect|nice|love it|cool|amazing/i.test(lower)) {
                          setChatMessages(prev => [...prev, {
                            id: replyId,
                            role: "ai",
                            text: "You're welcome! 🎨 Let me know if you'd like to try a different enhancement or have any other questions.",
                          }]);
                        // Auto enhance
                        } else if (/auto|automatic|one.?click|quick|fast|easy|fix/i.test(lower)) {
                          setChatMessages(prev => [...prev, {
                            id: replyId,
                            role: "ai",
                            text: file
                              ? "Auto Enhance is our AI-powered one-click fix — it analyzes your image and applies the optimal combination of adjustments automatically."
                              : "Upload an image and I'll auto-enhance it with one click!",
                            ...(file ? { action: { type: "auto" as EnhanceMediaBodyEnhancementType } } : {}),
                          }]);
                        // Fallback with AI context
                        } else if (aiSuggestion) {
                          const friendlyEnhancement = getEnhancementMeta(aiSuggestion.suggestedEnhancement as EnhanceMediaBodyEnhancementType).label;
                          setChatMessages(prev => [...prev, {
                            id: replyId,
                            role: "ai",
                            text: `Based on my analysis of your ${imageType} image, I recommend "${friendlyEnhancement}" (${confidencePct}% confidence). ${aiSuggestion.description}\n\nYou can also ask me about specific enhancements like upscaling, portrait retouching, cinematic grading, or lighting fixes.`,
                            action: {
                              type: aiSuggestion.suggestedEnhancement as EnhanceMediaBodyEnhancementType,
                              filter: aiSuggestion.suggestedFilter ?? undefined,
                            },
                          }]);
                        } else if (file) {
                          setChatMessages(prev => [...prev, {
                            id: replyId,
                            role: "ai",
                            text: "I'm analyzing your image now. In the meantime, you can ask me about specific enhancements:\n\n• \"upscale\" — increase resolution\n• \"portrait\" — skin smoothing\n• \"cinematic\" — film-grade color\n• \"lighting\" — fix exposure\n• \"auto\" — one-click fix\n\nOr wait for my personalized recommendation!",
                          }]);
                        } else {
                          setChatMessages(prev => [...prev, {
                            id: replyId,
                            role: "ai",
                            text: "Upload an image to get started! I'll analyze it and suggest the perfect enhancement. You can also ask me about what I can do — try \"help\".",
                          }]);
                        }
                      }, 400);
                    }}
                    className="flex items-center gap-2"
                  >
                    <Input
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      placeholder="Ask me anything..."
                      className="flex-1 h-8 text-xs bg-zinc-900 border-zinc-700 focus-visible:ring-teal-500"
                    />
                    <Button type="submit" size="sm" className="h-8 w-8 p-0 bg-teal-600 hover:bg-teal-700 shrink-0">
                      <Send className="w-3.5 h-3.5" />
                    </Button>
                  </form>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Floating AI Chat Toggle Button — available to all users */}
          <motion.button
            onClick={() => setShowAiChat(v => !v)}
            className={cn(
              "fixed bottom-4 right-4 z-50 w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all",
              showAiChat
                ? "bg-zinc-800 border border-white/10 text-zinc-400 hover:text-white"
                : "bg-teal-600 hover:bg-teal-500 text-white shadow-[0_0_20px_rgba(20,184,166,0.4)]"
            )}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
          >
            {showAiChat ? (
              <X className="w-5 h-5" />
            ) : (
              <>
                <MessageSquare className="w-5 h-5" />
                {(aiSuggestion || isAnalyzing) && !showAiChat && (
                  <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-teal-400 animate-pulse border-2 border-zinc-950" />
                )}
              </>
            )}
          </motion.button>
        </div>
      </TooltipProvider>
    </Layout>
  );
}
