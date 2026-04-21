import React, { useState, useEffect, useCallback, useRef } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { saveToHistory } from "@/lib/local-history";
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
} from "lucide-react";
import { Input } from "@/components/ui/input";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProcessStage = "idle" | "uploading" | "processing" | "completed" | "failed";
type EditorMode = "simple" | "advanced";

interface FilterState {
  brightness: number;
  contrast: number;
  saturation: number;
  sharpness: number;
  warmth: number;
  highlights: number;
  shadows: number;
  hue: number;
}

interface TransformState {
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

interface CropBox {
  x: number;
  y: number;
  x2: number;
  y2: number;
}

interface AISuggestion {
  description: string;
  suggestedEnhancement: string;
  suggestedFilter?: string | null;
  detectedSubjects: string[];
  confidence: number;
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

// ---------------------------------------------------------------------------
// Defaults & constants
// ---------------------------------------------------------------------------

const DEFAULT_FILTERS: FilterState = {
  brightness: 100, contrast: 100, saturation: 100, sharpness: 100,
  warmth: 0, highlights: 0, shadows: 0, hue: 0,
};
const DEFAULT_TRANSFORM: TransformState = { rotation: 0, flipH: false, flipV: false };
const DEFAULT_CROP: CropBox = { x: 0, y: 0, x2: 100, y2: 100 };
const MAX_FILE_MB = 100;
const ONBOARDING_KEY = "glimpse_onboarding_done";

// -- Filter Gallery (29 presets including premium) --
// `f` = CSS filter preview values, `cssExtra` = extra CSS filter string to better match Sharp tint/gamma
const FILTER_PRESETS: { name: string; key: string; f: FilterState; serverFilter: string | null; gradient: string; premium?: boolean; cssExtra?: string }[] = [
  { name: "Original",    key: "original",      f: DEFAULT_FILTERS,                                                                                      serverFilter: null, gradient: "from-zinc-700 to-zinc-800" },
  { name: "Vivid",       key: "vivid",         f: { ...DEFAULT_FILTERS, brightness: 103, contrast: 120, saturation: 135, sharpness: 110 },              serverFilter: "vivid", gradient: "from-red-500 to-amber-500" },
  { name: "Portrait",    key: "portrait",      f: { ...DEFAULT_FILTERS, brightness: 104, contrast: 95, saturation: 92, sharpness: 105 },                serverFilter: "portrait", gradient: "from-rose-400 to-pink-500", cssExtra: "sepia(5%)" },
  { name: "B&W",         key: "bw",            f: { ...DEFAULT_FILTERS, contrast: 115, saturation: 0 },                                                 serverFilter: "bw", gradient: "from-zinc-300 to-zinc-600" },
  { name: "Film",        key: "film",          f: { ...DEFAULT_FILTERS, brightness: 97, contrast: 92, saturation: 80, sharpness: 95 },                  serverFilter: "film", gradient: "from-amber-600 to-yellow-800", cssExtra: "sepia(22%) hue-rotate(-5deg)" },
  { name: "HDR",         key: "hdr",           f: { ...DEFAULT_FILTERS, contrast: 140, saturation: 120, sharpness: 118 },                               serverFilter: "hdr", gradient: "from-cyan-500 to-blue-600" },
  { name: "Vintage",     key: "vintage",       f: { ...DEFAULT_FILTERS, brightness: 95, contrast: 92, saturation: 70, sharpness: 92 },                  serverFilter: "vintage", gradient: "from-amber-400 to-orange-700", cssExtra: "sepia(30%) hue-rotate(-8deg)" },
  { name: "Cinematic",   key: "cinematic",     f: { ...DEFAULT_FILTERS, brightness: 96, contrast: 108, saturation: 85 },                                serverFilter: "cinematic", gradient: "from-teal-600 to-cyan-800", cssExtra: "sepia(8%) hue-rotate(185deg)" },
  { name: "Vibrant",     key: "vibrant",       f: { ...DEFAULT_FILTERS, brightness: 105, contrast: 110, saturation: 145, sharpness: 108 },              serverFilter: "vibrant", gradient: "from-fuchsia-500 to-pink-600" },
  { name: "Film Noir",   key: "filmnoir",      f: { ...DEFAULT_FILTERS, brightness: 90, contrast: 130, saturation: 0, sharpness: 112 },                 serverFilter: "filmnoir", gradient: "from-zinc-900 to-zinc-700" },
  { name: "Golden Hour", key: "goldenhour",    f: { ...DEFAULT_FILTERS, brightness: 106, saturation: 110 },                                             serverFilter: "goldenhour", gradient: "from-yellow-400 to-orange-500", cssExtra: "sepia(18%) hue-rotate(-10deg)" },
  { name: "Moody",       key: "moody",         f: { ...DEFAULT_FILTERS, brightness: 92, contrast: 105, saturation: 75 },                                serverFilter: "moody", gradient: "from-indigo-800 to-purple-900", cssExtra: "sepia(10%) hue-rotate(220deg)" },
  { name: "Fresh",       key: "fresh",         f: { ...DEFAULT_FILTERS, brightness: 108, saturation: 115 },                                             serverFilter: "fresh", gradient: "from-green-400 to-emerald-500" },
  { name: "Retro",       key: "retro",         f: { ...DEFAULT_FILTERS, brightness: 98, contrast: 95, saturation: 65, sharpness: 92 },                  serverFilter: "retro", gradient: "from-orange-600 to-red-800", cssExtra: "sepia(28%) hue-rotate(-12deg)" },
  { name: "Dramatic",    key: "dramatic",      f: { ...DEFAULT_FILTERS, brightness: 95, contrast: 140, saturation: 110, sharpness: 120 },               serverFilter: "dramatic", gradient: "from-red-700 to-zinc-900" },
  { name: "Warm Tone",   key: "warm_tone",     f: { ...DEFAULT_FILTERS, brightness: 104, saturation: 110, warmth: 20 },                                 serverFilter: "warm_tone", gradient: "from-orange-400 to-red-500", cssExtra: "sepia(15%)" },
  { name: "Cool Tone",   key: "cool_tone",     f: { ...DEFAULT_FILTERS, brightness: 102, saturation: 95, warmth: -20 },                                 serverFilter: "cool_tone", gradient: "from-sky-400 to-blue-600", cssExtra: "hue-rotate(195deg) sepia(8%)" },
  { name: "Sunset",      key: "sunset",        f: { ...DEFAULT_FILTERS, brightness: 103, saturation: 120, warmth: 25 },                                 serverFilter: "sunset", gradient: "from-orange-500 to-pink-600", cssExtra: "sepia(20%) hue-rotate(-15deg)" },
  { name: "Matte",       key: "matte",         f: { ...DEFAULT_FILTERS, brightness: 102, contrast: 85, saturation: 70 },                                serverFilter: "matte", gradient: "from-stone-400 to-stone-600" },
  { name: "Neon",        key: "neon",          f: { ...DEFAULT_FILTERS, contrast: 130, saturation: 160, sharpness: 115 },                               serverFilter: "neon", gradient: "from-violet-500 to-fuchsia-600" },
  // Premium filters
  { name: "Airy",        key: "airy",          f: { ...DEFAULT_FILTERS, brightness: 112, contrast: 90, saturation: 85 },                                serverFilter: "airy", gradient: "from-sky-200 to-blue-300", premium: true, cssExtra: "sepia(5%) hue-rotate(200deg)" },
  { name: "Teal & Orange", key: "teal_orange", f: { ...DEFAULT_FILTERS, contrast: 115, saturation: 120 },                                              serverFilter: "teal_orange", gradient: "from-teal-500 to-orange-500", premium: true, cssExtra: "sepia(15%) hue-rotate(-5deg)" },
  { name: "Pastel",      key: "pastel",        f: { ...DEFAULT_FILTERS, brightness: 115, contrast: 85, saturation: 55 },                                serverFilter: "pastel", gradient: "from-pink-300 to-violet-300", premium: true, cssExtra: "sepia(8%) hue-rotate(320deg)" },
  { name: "Noir Color",  key: "noir_color",    f: { ...DEFAULT_FILTERS, brightness: 88, contrast: 125, saturation: 40 },                                serverFilter: "noir_color", gradient: "from-zinc-800 to-amber-900", premium: true },
  { name: "Cross Process", key: "cross_process", f: { ...DEFAULT_FILTERS, contrast: 120, saturation: 130 },                                            serverFilter: "cross_process", gradient: "from-green-500 to-purple-600", premium: true, cssExtra: "hue-rotate(30deg) sepia(8%)" },
  { name: "Cyberpunk",   key: "cyberpunk",     f: { ...DEFAULT_FILTERS, contrast: 130, saturation: 150 },                                               serverFilter: "cyberpunk", gradient: "from-cyan-400 to-fuchsia-600", premium: true, cssExtra: "hue-rotate(280deg) sepia(10%)" },
  { name: "Arctic",      key: "arctic",        f: { ...DEFAULT_FILTERS, brightness: 110, contrast: 95, saturation: 60, warmth: -30 },                   serverFilter: "arctic", gradient: "from-cyan-200 to-blue-400", premium: true, cssExtra: "hue-rotate(195deg) sepia(5%)" },
  { name: "Ember",       key: "ember",         f: { ...DEFAULT_FILTERS, brightness: 95, contrast: 115, saturation: 115, warmth: 30 },                   serverFilter: "ember", gradient: "from-orange-600 to-red-700", premium: true, cssExtra: "sepia(18%)" },
  { name: "Chrome",      key: "chrome",        f: { ...DEFAULT_FILTERS, brightness: 108, contrast: 120, saturation: 30, sharpness: 115 },               serverFilter: "chrome", gradient: "from-zinc-300 to-zinc-500", premium: true },
];

// -- Simple-mode one-click presets (expanded) --
const SIMPLE_PRESETS: { type: EnhanceMediaBodyEnhancementType; label: string; desc: string; icon: React.ReactNode; filterName?: string }[] = [
  { type: "auto",                   label: "Auto Enhance",     desc: "AI-powered one-click fix",            icon: <Wand2        className="w-5 h-5" /> },
  { type: "portrait",               label: "Portrait Polish",  desc: "Smooth skin & warm tones",            icon: <Eye          className="w-5 h-5" /> },
  { type: "lighting_enhance",       label: "Fix Lighting",     desc: "Mood-aware shadow & highlight fix",   icon: <Sun          className="w-5 h-5" /> },
  { type: "color_grade_cinematic",  label: "Cinematic Grade",  desc: "Film-grade color grading",            icon: <Film         className="w-5 h-5" /> },
  { type: "color_grade_warm",       label: "Warm Tones",       desc: "Golden, warm color palette",          icon: <Thermometer  className="w-5 h-5" /> },
  { type: "color_grade_cool",       label: "Cool Tones",       desc: "Crisp, blue-shift palette",           icon: <Droplets     className="w-5 h-5" /> },
  { type: "blur_background",        label: "Background Blur",  desc: "Intelligent portrait bokeh",          icon: <Focus        className="w-5 h-5" /> },
  { type: "skin_retouch",           label: "Skin Retouch",     desc: "Smooth skin with natural detail",     icon: <Paintbrush   className="w-5 h-5" /> },
  { type: "upscale",                label: "2x Upscale",       desc: "Double resolution with AI",           icon: <ZoomIn       className="w-5 h-5" /> },
  { type: "upscale_4x",             label: "4x Upscale",       desc: "Quadruple resolution (pro)",          icon: <Layers       className="w-5 h-5" /> },
  { type: "face_restore",            label: "Face Restore",     desc: "GFPGAN AI face restoration",          icon: <ScanFace     className="w-5 h-5" /> },
  { type: "codeformer",              label: "CodeFormer",       desc: "CodeFormer face restoration",         icon: <ScanEye      className="w-5 h-5" /> },
  { type: "hybrid",                  label: "Hybrid Restore",   desc: "CodeFormer + GFPGAN max quality",     icon: <Sparkles     className="w-5 h-5" /> },
  { type: "auto_face",               label: "Auto Face AI",     desc: "Auto-select best face model",         icon: <Sparkles     className="w-5 h-5" /> },
  { type: "old_photo_restore",       label: "Old Photo Fix",    desc: "Restore old/damaged photos",          icon: <ImageUp      className="w-5 h-5" /> },
  { type: "esrgan_upscale_2x",       label: "ESRGAN 2x",        desc: "Real-ESRGAN super-resolution 2×",     icon: <ZoomIn       className="w-5 h-5" /> },
  { type: "esrgan_upscale_4x",       label: "ESRGAN 4x",        desc: "Real-ESRGAN super-resolution 4×",     icon: <Layers       className="w-5 h-5" /> },
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
      { type: "portrait", label: "Portrait Polish" },
      { type: "beauty", label: "Beauty" },
      { type: "skin_retouch", label: "Skin Retouch" },
      { type: "blur_background", label: "Background Blur" },
      { type: "lighting_enhance", label: "Fix Lighting" },
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
    cssExtra ?? "",
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
  const PREMIUM_FEATURES = new Set(["upscale_4x", "posture", "codeformer", "hybrid", "auto_face", "face_restore_hd", "esrgan_upscale_4x"]);
  const RESTORATION_FEATURES = new Set(["face_restore", "codeformer", "hybrid", "auto_face", "old_photo_restore", "esrgan_upscale_2x", "esrgan_upscale_4x", "face_restore_hd"]);
  const BASIC_PLUS_FEATURES = new Set(["stabilize", "trim"]);
  const PREMIUM_FILTER_KEYS = new Set([
    "airy", "teal_orange", "pastel", "noir_color", "cross_process",
    "cyberpunk", "arctic", "ember", "chrome",
  ]);
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
  const [mediaType, setMediaType] = useState<UploadMediaBodyMediaType>(studioMode === "video" ? "video" : "photo");
  const [enhancementType, setEnhancementType] = useState<EnhanceMediaBodyEnhancementType>("auto");
  const [selectedFilter, setSelectedFilter] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<number | undefined>(undefined);
  const [currentJobId, setCurrentJobId] = useState<number | null>(null);
  const [processStage, setProcessStage] = useState<ProcessStage>("idle");

  // Image zoom
  const [zoomLevel, setZoomLevel] = useState(1);
  const zoomIn = () => setZoomLevel((z) => Math.min(z + 0.25, 4));
  const zoomOut = () => setZoomLevel((z) => Math.max(z - 0.25, 0.25));
  const zoomReset = () => setZoomLevel(1);
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

  // Complementary filter suggestions shown after enhancement completes
  const [suggestedFilters, setSuggestedFilters] = useState<string[]>([]);

  // AI Power-Up panel (below image)
  const [showPowerUp, setShowPowerUp] = useState(false);

  // Combo enhancement: upscale after primary enhancement
  const [upscaleAfter, setUpscaleAfter] = useState<"upscale" | "upscale_4x" | null>(null);
  const upscaleChainRef = useRef(false); // tracks whether we're in chained upscale step
  const pendingExportRef = useRef(false);  // auto-download after process+export flow

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

  // Track the uploaded job ID for AI analysis (set after upload, before enhance)
  const uploadedJobIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!currentJob) return;
    if (currentJob.status === "completed" && processStage !== "completed") {
      // Check if we need to chain an upscale step
      if (upscaleAfter && !upscaleChainRef.current) {
        upscaleChainRef.current = true;
        setProcessStage("processing");
        toast({ title: "Step 2: Upscaling...", description: `Applying ${upscaleAfter === "upscale_4x" ? "4x" : "2x"} upscale to enhanced image.` });
        // Extract processed base64 (strip data URI prefix)
        const processedUri = currentJob.processedUrl ?? "";
        const rawB64 = processedUri.replace(/^data:[^;]+;base64,/, "");
        if (!rawB64) {
          setProcessStage("completed");
          upscaleChainRef.current = false;
          return;
        }
        // Re-upload the processed image, then enhance with upscale
        const fname = `upscale-${file?.name ?? "image.jpg"}`;
        uploadMedia.mutate(
          { data: { filename: fname, mimeType: file?.type ?? "image/jpeg", size: rawB64.length, mediaType: "photo", base64Data: rawB64 } },
          {
            onSuccess: (newJob) => {
              setCurrentJobId(newJob.id);
              enhanceMedia.mutate(
                { data: { jobId: newJob.id, enhancementType: upscaleAfter } },
                {
                  onError: () => {
                    setProcessStage("failed");
                    upscaleChainRef.current = false;
                    toast({ title: "Upscale failed", description: "The chained upscale step failed.", variant: "destructive" });
                  },
                },
              );
            },
            onError: () => {
              setProcessStage("failed");
              upscaleChainRef.current = false;
              toast({ title: "Upscale failed", description: "Failed to upload for upscale chain.", variant: "destructive" });
            },
          },
        );
        return;
      }
      setProcessStage("completed");
      upscaleChainRef.current = false;
      toast({ title: "Enhancement complete!", description: upscaleAfter ? "Enhancement + upscale applied!" : "Your media has been successfully enhanced." });

      // Suggest complementary filters based on the enhancement type applied
      const filterMap: Record<string, string[]> = {
        portrait: ["portrait", "airy", "warm_tone"],
        beauty: ["portrait", "fresh", "pastel"],
        skin_retouch: ["portrait", "matte", "airy"],
        face_restore: ["vivid", "warm_tone", "fresh"],
        auto_face: ["vivid", "warm_tone", "portrait"],
        old_photo_restore: ["vintage", "film", "warm_tone"],
        codeformer: ["vivid", "fresh", "warm_tone"],
        color_grade_cinematic: ["cinematic", "moody", "dramatic"],
        color_grade_warm: ["goldenhour", "sunset", "ember"],
        color_grade_cool: ["arctic", "cool_tone", "matte"],
        lighting_enhance: ["hdr", "vivid", "dramatic"],
        auto: ["vivid", "cinematic", "fresh"],
      };
      setSuggestedFilters(filterMap[enhancementType] ?? []);

      // Save to local history (photos only, max 5)
      if (studioMode === "photo" && currentJob.processedUrl) {
        saveToHistory({
          filename: file?.name ?? "image.jpg",
          enhancementType: enhancementType ?? "auto",
          dataUri: currentJob.processedUrl,
          mimeType: file?.type ?? "image/jpeg",
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

  // Apply AI suggestion
  const applyAiSuggestion = useCallback(() => {
    if (!aiSuggestion) return;
    pushUndo();
    const et = aiSuggestion.suggestedEnhancement as EnhanceMediaBodyEnhancementType;
    setEnhancementType(et);
    if (aiSuggestion.suggestedFilter) {
      const fp = FILTER_PRESETS.find((p) => p.key === aiSuggestion.suggestedFilter || p.serverFilter === aiSuggestion.suggestedFilter);
      if (fp) {
        setSelectedFilter(fp.key);
        setFilters(fp.f);
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
    toast({ title: "AI suggestion applied", description: `Using ${et} enhancement` });
  }, [aiSuggestion, pushUndo, toast]);

  // Apply a specific alternative enhancement
  const applyAlternative = useCallback((et: EnhanceMediaBodyEnhancementType) => {
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
    toast({ title: "Enhancement selected", description: `Switched to ${et}` });
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
      const ext = mime === "image/png" ? ".png" : mime === "image/webp" ? ".webp" : ".jpg";
      const baseName = (file?.name ?? "image.jpg").replace(/\.[^.]+$/, "");
      a.download = `enhanced-${baseName}${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ title: "Download started", description: "Your enhanced image is being saved." });
    } catch {
      window.open(currentJob.processedUrl!, "_blank");
      toast({ title: "Download", description: "Image opened in a new tab. Right-click to save." });
    }
  }, [processStage, currentJob?.processedUrl, file?.name, toast]);

  const handleProcess = useCallback(async () => {
    if (!file || !base64Data) return;

    let effectiveType = enhancementType;
    const settings: Record<string, unknown> = {};

    // Simple mode: use selected filter for server-side
    if (editorMode === "simple" && selectedFilter) {
      const preset = FILTER_PRESETS.find((p) => p.key === selectedFilter);
      if (preset?.serverFilter) {
        effectiveType = "filter";
        settings.filterName = preset.serverFilter;
      }
    }

    // Skin smoothing
    if (skinSmoothing !== 50) {
      settings.skinSmoothing = skinSmoothing;
    }

    // Video stabilize
    if (mediaType === "video" && stabilize) {
      effectiveType = "stabilize" as EnhanceMediaBodyEnhancementType;
    }

    // Video-specific settings
    if (mediaType === "video") {
      if (videoSpeed !== 1.0) settings.speed = videoSpeed;
      if (trimStart > 0 || trimEnd < 100) { settings.trimStart = trimStart; settings.trimEnd = trimEnd; }
      if (muteAudio) settings.muteAudio = true;
      if (denoise) settings.denoise = true;
      if (videoColorGrade) settings.videoColorGrade = videoColorGrade;
    }

    let finalBase64 = base64Data;
    const hasT = transform.rotation !== 0 || transform.flipH || transform.flipV;
    const hasF = filters.brightness !== 100 || filters.contrast !== 100 || filters.saturation !== 100 || filters.sharpness !== 100;
    const hasC = cropEnabled && (cropBox.x !== 0 || cropBox.y !== 0 || cropBox.x2 !== 100 || cropBox.y2 !== 100);

    if (editorMode === "advanced" && mediaType === "photo" && (hasT || hasF || hasC)) {
      try {
        const cssExtra = selectedFilter ? FILTER_PRESETS.find(p => p.key === selectedFilter)?.cssExtra : undefined;
        finalBase64 = await applyTransformsToBase64(file, transform, cropEnabled ? cropBox : DEFAULT_CROP, filters, cssExtra);
      } catch {
        toast({ title: "Transform error", description: "Could not apply edits. Uploading original.", variant: "destructive" });
      }
    }

    // Pass advanced slider settings
    if (editorMode === "advanced") {
      if (filters.brightness !== 100) settings.brightness = filters.brightness;
      if (filters.contrast !== 100) settings.contrast = filters.contrast;
      if (filters.saturation !== 100) settings.saturation = filters.saturation;
      if (filters.sharpness !== 100) settings.sharpness = filters.sharpness;
      if (filters.warmth !== 0) settings.warmth = filters.warmth;
      if (filters.highlights !== 0) settings.highlights = filters.highlights;
      if (filters.shadows !== 0) settings.shadows = filters.shadows;
      if (filters.hue !== 0) settings.hue = filters.hue;
    }

    setProcessStage("uploading");
    uploadMedia.mutate(
      { data: { filename: file.name, mimeType: file.type, size: file.size, mediaType, base64Data: finalBase64 } },
      {
        onSuccess: (job) => {
          setCurrentJobId(job.id);
          setProcessStage("processing");
          enhanceMedia.mutate(
            { data: { jobId: job.id, enhancementType: effectiveType, presetId, settings: Object.keys(settings).length > 0 ? settings : undefined } },
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
          let desc = err?.data?.error ?? err?.message ?? "Failed to upload file.";
          if (status === 413) desc = "File too large. Try a smaller file (max 100 MB).";
          else if (status === 403) desc = "Free quota exceeded. Please upgrade to continue.";
          else if (status === 401) desc = "Session expired. Please log in again.";
          toast({ title: "Upload failed", description: desc, variant: "destructive" });
        },
      },
    );
  }, [file, base64Data, enhancementType, mediaType, transform, filters, cropBox, cropEnabled, stabilize, presetId, editorMode, selectedFilter, skinSmoothing]);

  // Process & Export — for staged state: trigger processing then auto-download
  const handleProcessAndExport = useCallback(() => {
    pendingExportRef.current = true;
    void handleProcess();
  }, [handleProcess]);

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
    setFile(null); setPreviewUrl(""); setBase64Data("");
    setCurrentJobId(null); setProcessStage("idle"); setZoomLevel(1);
    setTransform(DEFAULT_TRANSFORM); setFilters(DEFAULT_FILTERS);
    setCropBox(DEFAULT_CROP); setCropEnabled(false);
    setStabilize(false); setDenoise(false);
    setVideoSpeed(1.0); setTrimStart(0); setTrimEnd(100); setMuteAudio(false); setVideoColorGrade(null);
    setSelectedFilter(null); setAiSuggestion(null);
    setSkinSmoothing(50); uploadedJobIdRef.current = null;
    setUndoStack([]); setChatMessages([]); setShowAiChat(false);
    setUpscaleAfter(null); upscaleChainRef.current = false;
    setSuggestedFilters([]);
  };

  const isProcessing = processStage === "uploading" || processStage === "processing";
  const isCompleted = processStage === "completed";
  const hasEdits = transform.rotation !== 0 || transform.flipH || transform.flipV
    || filters.brightness !== 100 || filters.contrast !== 100 || filters.saturation !== 100 || filters.sharpness !== 100
    || filters.warmth !== 0 || filters.highlights !== 0 || filters.shadows !== 0 || filters.hue !== 0
    || (cropEnabled && (cropBox.x !== 0 || cropBox.y !== 0 || cropBox.x2 !== 100 || cropBox.y2 !== 100));

  const activePresetCssExtra = selectedFilter ? FILTER_PRESETS.find(p => p.key === selectedFilter)?.cssExtra : undefined;
  const previewStyle = buildPreviewStyle(transform, filters, cropEnabled ? cropBox : DEFAULT_CROP, activePresetCssExtra);
  const stageInfo = STAGE_INFO[processStage];

  const visibleFilters = showAllFilters ? FILTER_PRESETS : FILTER_PRESETS.slice(0, 18);

  const ENHANCEMENT_TYPES: { type: EnhanceMediaBodyEnhancementType; label: string; icon: React.ReactNode }[] = [
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

  return (
    <Layout>
      <TooltipProvider delayDuration={200}>
        {showOnboarding && <OnboardingWalkthrough onComplete={completeOnboarding} />}

        <div className="flex flex-col lg:flex-row h-[calc(100vh-4rem)] overflow-hidden">

          {/* Sidebar */}
          <aside className="w-full lg:w-80 xl:w-[22rem] border-r border-white/10 bg-zinc-950 flex flex-col shrink-0 z-10 max-h-[50vh] lg:max-h-full lg:h-full overflow-hidden">
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

                {/* AI Suggestion Banner */}
                <AnimatePresence>
                  {file && (isAnalyzing || aiSuggestion) && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mb-4 overflow-hidden"
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
                      ) : aiSuggestion && (
                        <div className="rounded-xl border border-teal-500/30 bg-gradient-to-r from-teal-500/10 to-cyan-500/10 p-3">
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-full bg-teal-500/20 flex items-center justify-center shrink-0 mt-0.5">
                              <ScanEye className="w-4 h-4 text-teal-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="text-xs font-semibold text-teal-200 tracking-wide">AI Recommendation</p>
                                <Badge variant="outline" className="text-[9px] border-teal-500/40 text-teal-300 px-1.5 py-0 h-4 capitalize">
                                  {inferImageType(aiSuggestion.detectedSubjects)}
                                </Badge>
                              </div>
                              <p className="text-xs text-zinc-300 leading-relaxed mb-2">{aiSuggestion.description}</p>
                              <div className="flex flex-wrap gap-1 mb-2">
                                {aiSuggestion.detectedSubjects.slice(0, 4).map((s) => (
                                  <Badge key={s} variant="outline" className="text-[9px] border-teal-500/30 text-teal-300 px-1.5 py-0 h-4">{s}</Badge>
                                ))}
                              </div>
                              <Button size="sm" className="h-7 text-xs bg-teal-600 hover:bg-teal-700 text-white w-full font-medium" onClick={applyAiSuggestion}>
                                <Sparkles className="w-4 h-4 mr-1.5" />
                                Apply: {aiSuggestion.suggestedEnhancement}
                                {aiSuggestion.suggestedFilter && ` + ${aiSuggestion.suggestedFilter}`}
                              </Button>
                              {/* Alternative suggestions based on image type */}
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
                                      {alts.map(a => (
                                        <button
                                          key={a.type}
                                          onClick={() => applyAlternative(a.type)}
                                          className="text-[10px] px-2.5 py-1 rounded-full border border-zinc-700 text-zinc-400 hover:border-teal-500 hover:text-teal-300 transition-colors"
                                        >
                                          {a.label}
                                        </button>
                                      ))}
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
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* SIMPLE MODE */}
                {editorMode === "simple" && (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Quick Enhance</Label>
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
                                  if (p.type === "color_grade_warm") setFilters({ ...DEFAULT_FILTERS, warmth: 20, saturation: 110 });
                                  else if (p.type === "color_grade_cool") setFilters({ ...DEFAULT_FILTERS, warmth: -20, saturation: 95 });
                                  else if (p.type === "color_grade_cinematic") setFilters({ ...DEFAULT_FILTERS, brightness: 96, contrast: 105, saturation: 85 });
                                  else if (p.type === "lighting_enhance") setFilters({ ...DEFAULT_FILTERS, brightness: 108, contrast: 110 });
                                  else if (p.type === "portrait") setFilters({ ...DEFAULT_FILTERS, brightness: 105, contrast: 95, saturation: 88 });
                                  else setFilters(DEFAULT_FILTERS);
                                }}
                              >
                                {locked && (
                                  <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500/90 flex items-center justify-center z-10">
                                    <Lock className="w-2.5 h-2.5 text-zinc-900" />
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
                            <TooltipContent side="right" className="text-xs">{locked ? `🔒 ${tierLabel(p.type)} — Upgrade to unlock` : p.desc}</TooltipContent>
                          </Tooltip>
                        );
                        })}
                      </div>
                    </div>

                    {/* Combo: Also Upscale toggle */}
                    {enhancementType !== "upscale" && enhancementType !== "upscale_4x" && file && (
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-2.5 py-1.5 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <ZoomIn className="w-3.5 h-3.5 text-teal-400" />
                          <Label className="text-[11px] font-medium text-zinc-300">Also Upscale</Label>
                          {upscaleAfter && (
                            <div className="flex gap-1 ml-1">
                              <button
                                className={cn(
                                  "text-[10px] py-0.5 px-1.5 rounded border transition-all font-medium",
                                  upscaleAfter === "upscale"
                                    ? "border-teal-500 bg-teal-500/10 text-teal-300"
                                    : "border-zinc-700 text-zinc-500 hover:border-zinc-600"
                                )}
                                onClick={() => setUpscaleAfter("upscale")}
                              >2x</button>
                              <button
                                className={cn(
                                  "text-[10px] py-0.5 px-1.5 rounded border transition-all font-medium",
                                  isFeatureLocked("upscale_4x") ? "opacity-40 cursor-not-allowed border-zinc-700 text-zinc-600" :
                                  upscaleAfter === "upscale_4x"
                                    ? "border-teal-500 bg-teal-500/10 text-teal-300"
                                    : "border-zinc-700 text-zinc-500 hover:border-zinc-600"
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

                    <Separator className="bg-white/5" />

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Filter Gallery</Label>
                        <button onClick={() => setShowAllFilters(!showAllFilters)} className="text-[11px] text-teal-500 hover:text-teal-400">
                          {showAllFilters ? "Less" : `All ${FILTER_PRESETS.length}`}
                        </button>
                      </div>
                      {suggestedFilters.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap mb-1">
                          <span className="text-[10px] text-teal-400/70">Suggested:</span>
                          {suggestedFilters.map((key) => {
                            const p = FILTER_PRESETS.find((f) => f.key === key);
                            if (!p) return null;
                            return (
                              <button key={key}
                                className={cn("text-[10px] px-2 py-0.5 rounded-full border transition-colors",
                                  selectedFilter === key ? "border-teal-500 bg-teal-500/20 text-teal-300" : "border-zinc-700 text-zinc-400 hover:border-teal-500/50 hover:text-teal-300")}
                                onClick={() => { pushUndo(); setSelectedFilter(key); setFilters(p.f); if (p.serverFilter) setEnhancementType("filter"); }}
                              >{p.name}</button>
                            );
                          })}
                        </div>
                      )}
                      <div className="grid grid-cols-6 gap-1">
                        {visibleFilters.map((p) => {
                          const filterLocked = isFeatureLocked("filter", p.key);
                          return (
                          <Tooltip key={p.key}>
                            <TooltipTrigger asChild>
                              <motion.button
                                whileTap={{ scale: 0.95 }}
                                className={cn(
                                  "relative rounded-md border transition-all overflow-hidden h-12 group",
                                  filterLocked
                                    ? "border-zinc-800 opacity-50 cursor-not-allowed"
                                    : selectedFilter === p.key ? "border-teal-500 ring-1 ring-teal-500/30" : "border-zinc-800 hover:border-zinc-600",
                                )}
                                onClick={() => {
                                  if (filterLocked) {
                                    toast({ title: "Premium filter", description: `Upgrade to Premium to unlock the ${p.name} filter.`, variant: "destructive" });
                                    return;
                                  }
                                  pushUndo();
                                  setSelectedFilter(p.key === "original" ? null : p.key);
                                  setFilters(p.f);
                                  if (p.serverFilter) setEnhancementType("filter");
                                }}
                              >
                                <div className={cn("absolute inset-0 bg-gradient-to-br opacity-60", p.gradient)} />
                                <div className="absolute inset-0 flex items-end p-0.5">
                                  <span className="text-[9px] font-medium text-white drop-shadow-lg leading-tight truncate">{p.name}</span>
                                </div>
                                {filterLocked ? (
                                  <div className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-amber-500/90 flex items-center justify-center">
                                    <Lock className="w-2 h-2 text-zinc-900" />
                                  </div>
                                ) : p.premium && (
                                  <div className="absolute top-0.5 right-0.5">
                                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                  </div>
                                )}
                                {selectedFilter === p.key && (
                                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute top-0.5 left-0.5">
                                    <CheckCircle2 className="w-2.5 h-2.5 text-teal-400" />
                                  </motion.div>
                                )}
                              </motion.button>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="text-xs">
                              {p.name}{filterLocked ? " 🔒 Premium" : p.premium ? " (Premium)" : ""}
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
                            return (
                            <button key={p.key}
                              className={cn(
                                "relative rounded-lg border transition-all overflow-hidden h-12",
                                filterLocked
                                  ? "border-zinc-800 opacity-50 cursor-not-allowed"
                                  : selectedFilter === p.key ? "border-teal-500 ring-1 ring-teal-500/30" : "border-zinc-800 hover:border-zinc-600",
                              )}
                              onClick={() => {
                                if (filterLocked) {
                                  toast({ title: "Premium filter", description: `Upgrade to Premium to unlock ${p.name}.`, variant: "destructive" });
                                  return;
                                }
                                pushUndo(); setFilters(p.f); setSelectedFilter(p.key === "original" ? null : p.key);
                              }}>
                              <div className={cn("absolute inset-0 bg-gradient-to-br opacity-60", p.gradient)} />
                              <div className="absolute inset-0 flex items-end p-1">
                                <span className="text-[8px] font-medium text-white drop-shadow-lg">{p.name}</span>
                              </div>
                              {filterLocked ? (
                                <div className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-amber-500/90 flex items-center justify-center">
                                  <Lock className="w-2 h-2 text-zinc-900" />
                                </div>
                              ) : p.premium && <div className="absolute top-0.5 right-0.5"><div className="w-1.5 h-1.5 rounded-full bg-amber-400" /></div>}
                            </button>
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
                            <p className="text-sm font-medium">Color Grade</p>
                          </div>
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
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                    className={cn("flex items-center gap-2 text-xs", stageInfo.colorClass)}>
                    {(processStage === "uploading" || processStage === "processing") && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {processStage === "completed" && <CheckCircle2 className="w-3.5 h-3.5" />}
                    {processStage === "failed"    && <AlertCircle  className="w-3.5 h-3.5" />}
                    <span className="text-xs">{processStage === "processing" && currentJob?.errorMessage ? currentJob.errorMessage : stageInfo.label}</span>
                    {processStage === "uploading"  && <span className="text-xs text-zinc-500 ml-auto">{upscaleAfter ? "step 1/3" : "step 1/2"}</span>}
                    {processStage === "processing" && <span className="text-xs text-zinc-500 ml-auto">{upscaleChainRef.current ? (upscaleAfter ? "step 3/3 — upscaling" : "step 2/2") : (upscaleAfter ? "step 2/3 — enhancing" : "step 2/2")}</span>}
                  </motion.div>
                )}
              </AnimatePresence>
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
            </div>
          </aside>

          {/* Main Preview */}
          <main className="flex-1 bg-zinc-900 relative flex flex-col min-h-0 min-w-0">
            <div className="flex-1 flex items-center justify-center p-4 overflow-hidden min-h-0">
              {!file ? (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-lg w-full">
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
                </motion.div>
              ) : (
                <div className="relative w-full h-full flex flex-col items-center justify-center gap-3">
                  {/* Top toolbar */}
                  <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-2">
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
                      {/* AI chat toggle moved to floating button */}
                      {isCompleted && (
                        <Tooltip>
                          <TooltipTrigger asChild>
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
                          </TooltipTrigger>
                          <TooltipContent side="bottom"><span className="text-xs">Hold to briefly show original image</span></TooltipContent>
                        </Tooltip>
                      )}
                      {isCompleted && currentJob?.processedUrl && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="outline" size="sm"
                              className={cn("bg-black/50 backdrop-blur border-white/10 hover:bg-white/10 text-xs h-8", splitCompare && "border-teal-500 text-teal-300")}
                              onClick={() => setSplitCompare(!splitCompare)}
                            >
                              <ArrowLeftRight className="w-3.5 h-3.5 mr-1.5" />Side-by-Side
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom"><span className="text-xs">Toggle side-by-side original vs enhanced view</span></TooltipContent>
                        </Tooltip>
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

                  {/* Image preview */}
                  <div className="relative max-w-[calc(100%-2rem)] max-h-[calc(100vh-14rem)] lg:max-h-[calc(100vh-10rem)] rounded-xl overflow-hidden border border-white/10 shadow-2xl bg-black flex items-center justify-center">
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
                    </AnimatePresence>

                    {splitCompare && isCompleted && currentJob?.processedUrl ? (
                      <div className="grid grid-cols-2 gap-3 w-full h-full min-h-0">
                        <div className="flex flex-col min-h-0 gap-1">
                          <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider shrink-0">Original</span>
                          <div className="rounded-lg border border-zinc-800 overflow-hidden bg-zinc-900 flex items-center justify-center flex-1 min-h-0">
                            {mediaType === "video"
                              ? <video src={previewUrl} controls className="max-w-full max-h-full object-contain" />
                              : <img src={previewUrl} alt="Original" className="max-w-full max-h-full object-contain" style={{ transform: `scale(${zoomLevel})`, transformOrigin: "center", transition: "transform 0.2s" }} />}
                          </div>
                        </div>
                        <div className="flex flex-col min-h-0 gap-1">
                          <span className="text-[10px] font-medium text-teal-400 uppercase tracking-wider shrink-0">Enhanced</span>
                          <div className="rounded-lg border border-teal-500/30 overflow-hidden bg-zinc-900 flex items-center justify-center flex-1 min-h-0">
                            {mediaType === "video"
                              ? <video src={currentJob.processedUrl} controls autoPlay loop muted className="max-w-full max-h-full object-contain" />
                              : <img src={currentJob.processedUrl} alt="Enhanced" className="max-w-full max-h-full object-contain" style={{ transform: `scale(${zoomLevel})`, transformOrigin: "center", transition: "transform 0.2s" }} />}
                          </div>
                        </div>
                      </div>
                    ) : isCompleted && currentJob?.processedUrl && !showCompare ? (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-center max-h-full">
                        {mediaType === "video"
                          ? <video src={currentJob.processedUrl} controls autoPlay loop muted className="max-w-full max-h-full object-contain" />
                          : <img src={currentJob.processedUrl} alt="Enhanced" className="max-w-full max-h-full object-contain" style={{ transform: `scale(${zoomLevel})`, transformOrigin: "center", transition: "transform 0.2s" }} />
                        }
                      </motion.div>
                    ) : (
                      mediaType === "video"
                        ? <video src={previewUrl} controls className="max-w-full max-h-full object-contain" />
                        : <div className="flex items-center justify-center max-h-full">
                            <img src={previewUrl} alt="Original"
                              className="max-w-full max-h-full object-contain transition-all duration-200"
                              style={{ ...(isProcessing ? { opacity: 0.5 } : previewStyle), transform: `scale(${zoomLevel})`, transformOrigin: "center" }} />
                          </div>
                    )}
                  </div>

                  {/* Zoom controls */}
                  {mediaType !== "video" && (
                    <div className="flex items-center justify-center gap-2 mt-1">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-400 hover:text-white" onClick={zoomOut} disabled={zoomLevel <= 0.25}>
                        <ZoomOut className="w-3.5 h-3.5" />
                      </Button>
                      <button onClick={zoomReset} className="text-[10px] text-zinc-500 hover:text-zinc-300 min-w-[40px] text-center tabular-nums">
                        {Math.round(zoomLevel * 100)}%
                      </button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-400 hover:text-white" onClick={zoomIn} disabled={zoomLevel >= 4}>
                        <ZoomIn className="w-3.5 h-3.5" />
                      </Button>
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
                    {isCompleted && (
                      <><span>&#8226;</span>
                      <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-teal-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />Enhanced
                      </motion.span></>
                    )}
                    {showCompare && <><span>&#8226;</span><span className="text-amber-400">Showing original</span></>}
                  </div>

                  {/* AI Power-Up panel */}
                  <AnimatePresence>
                    {showPowerUp && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="w-full max-w-lg overflow-hidden"
                      >
                        <div className="rounded-xl border border-teal-500/20 bg-zinc-950/80 backdrop-blur p-4 space-y-3">
                          {isAnalyzing ? (
                            <div className="flex items-center gap-3 justify-center py-3">
                              <Loader2 className="w-5 h-5 text-teal-400 animate-spin" />
                              <span className="text-xs text-teal-300">Scanning image with AI...</span>
                            </div>
                          ) : aiSuggestion ? (
                            <>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <ScanEye className="w-4 h-4 text-teal-400" />
                                  <span className="text-xs font-semibold text-teal-200 tracking-wide">AI Recommends</span>
                                  <Badge variant="outline" className="text-[9px] border-teal-500/40 text-teal-300 px-1.5 py-0 h-4 capitalize">
                                    {inferImageType(aiSuggestion.detectedSubjects)}
                                  </Badge>
                                </div>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex items-center gap-1.5 cursor-help">
                                      <div className={cn(
                                        "w-2 h-2 rounded-full",
                                        aiSuggestion.confidence >= 0.85 ? "bg-emerald-400" : aiSuggestion.confidence >= 0.6 ? "bg-amber-400" : "bg-red-400"
                                      )} />
                                      <span className={cn(
                                        "text-[10px] font-medium",
                                        aiSuggestion.confidence >= 0.85 ? "text-emerald-400" : aiSuggestion.confidence >= 0.6 ? "text-amber-400" : "text-red-400"
                                      )}>
                                        {Math.round(aiSuggestion.confidence * 100)}%
                                      </span>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent className="text-xs max-w-[200px]">
                                    {aiSuggestion.confidence >= 0.85
                                      ? "High confidence — AI is very sure this enhancement will look great"
                                      : aiSuggestion.confidence >= 0.6
                                        ? "Medium confidence — should produce good results"
                                        : "Low confidence — consider trying alternatives"}
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                              <p className="text-xs text-zinc-300 leading-relaxed">{aiSuggestion.description}</p>
                              <div className="flex flex-wrap gap-1">
                                {aiSuggestion.detectedSubjects.slice(0, 5).map(s => (
                                  <Badge key={s} variant="outline" className="text-[9px] border-teal-500/30 text-teal-300 px-1.5 py-0 h-4">{s}</Badge>
                                ))}
                              </div>
                              <div className="flex items-center gap-2">
                                <Button size="sm" className="flex-1 h-8 text-xs bg-teal-600 hover:bg-teal-700 text-white" onClick={applyAiSuggestion}>
                                  <Sparkles className="w-3 h-3 mr-1" />
                                  Apply: {aiSuggestion.suggestedEnhancement}
                                </Button>
                                <button
                                  onClick={() => setShowPowerUp(false)}
                                  className="text-[10px] text-zinc-500 hover:text-zinc-300 px-2 transition-colors"
                                >
                                  Dismiss
                                </button>
                              </div>
                              {/* Alternatives */}
                              {(() => {
                                const alts = getAlternatives(inferImageType(aiSuggestion.detectedSubjects), aiSuggestion.suggestedEnhancement);
                                if (alts.length === 0) return null;
                                return (
                                  <div className="pt-2 border-t border-white/5">
                                    <p className="text-[10px] text-zinc-500 mb-1.5">Other options:</p>
                                    <div className="flex flex-wrap gap-1">
                                      {alts.map(a => (
                                        <button
                                          key={a.type}
                                          onClick={() => { applyAlternative(a.type); setShowPowerUp(false); }}
                                          className="text-[10px] px-2.5 py-1 rounded-full border border-zinc-700 text-zinc-400 hover:border-teal-500 hover:text-teal-300 transition-colors"
                                        >
                                          {a.label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })()}
                            </>
                          ) : (
                            <div className="text-center py-3">
                              <p className="text-xs text-zinc-500">AI analysis not available yet</p>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {/* AI Power-Up toggle button */}
                  {!isProcessing && !isCompleted && (
                    <motion.button
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 }}
                      onClick={() => {
                        setShowPowerUp(v => !v);
                        // If no suggestion yet and not analyzing, trigger analysis from uploaded job
                        if (!aiSuggestion && !isAnalyzing && uploadedJobIdRef.current) {
                          runAnalysis(uploadedJobIdRef.current);
                        }
                      }}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-full border transition-all text-xs font-medium",
                        showPowerUp
                          ? "border-teal-500/40 bg-teal-500/10 text-teal-300"
                          : "border-zinc-700 bg-zinc-900/80 text-zinc-400 hover:border-teal-500/30 hover:text-teal-300 hover:bg-teal-500/5",
                      )}
                    >
                      <Zap className="w-3.5 h-3.5" />
                      AI Power-Up
                      {isAnalyzing && <Loader2 className="w-3 h-3 animate-spin" />}
                      {aiSuggestion && !showPowerUp && <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />}
                    </motion.button>
                  )}
                </div>
              )}
            </div>
          </main>

          {/* Floating AI Chat — bottom-right */}
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
                          {msg.action && !msg.applied && msg.role === "ai" && (
                            <div className="mt-2 pt-2 border-t border-white/5 space-y-1.5">
                              <p className="text-[10px] text-zinc-500">
                                Suggested: <span className="text-teal-300 capitalize">{msg.action.type}</span>
                                {msg.action.filter && <> · <span className="text-amber-300 capitalize">{msg.action.filter}</span></>}
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
                          )}
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
                            setChatMessages(prev => [...prev, {
                              id: replyId,
                              role: "ai",
                              text: `Based on my analysis of your ${imageType} image, I recommend "${aiSuggestion.suggestedEnhancement}"${aiSuggestion.suggestedFilter ? ` with the ${aiSuggestion.suggestedFilter} filter` : ""}. I'm ${confidencePct}% confident this will give you the best results. ${aiSuggestion.description}`,
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
                          setChatMessages(prev => [...prev, {
                            id: replyId,
                            role: "ai",
                            text: `Based on my analysis of your ${imageType} image, I recommend "${aiSuggestion.suggestedEnhancement}" (${confidencePct}% confidence). ${aiSuggestion.description}\n\nYou can also ask me about specific enhancements like upscaling, portrait retouching, cinematic grading, or lighting fixes.`,
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

          {/* Floating AI Chat Toggle Button */}
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