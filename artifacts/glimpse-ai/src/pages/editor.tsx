import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Layout from "../components/layout";
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
  Undo2,
  MessageSquare,
  Send,
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
const FILTER_PRESETS: { name: string; key: string; f: FilterState; serverFilter: string | null; gradient: string; premium?: boolean }[] = [
  { name: "Original",    key: "original",      f: DEFAULT_FILTERS,                                                                                      serverFilter: null, gradient: "from-zinc-700 to-zinc-800" },
  { name: "Vivid",       key: "vivid",         f: { ...DEFAULT_FILTERS, brightness: 108, contrast: 120, saturation: 140, sharpness: 110 },              serverFilter: "vivid", gradient: "from-red-500 to-amber-500" },
  { name: "Portrait",    key: "portrait",      f: { ...DEFAULT_FILTERS, brightness: 105, contrast: 95, saturation: 88, sharpness: 105 },                serverFilter: "portrait", gradient: "from-rose-400 to-pink-500" },
  { name: "B&W",         key: "bw",            f: { ...DEFAULT_FILTERS, contrast: 115, saturation: 0 },                                                 serverFilter: "bw", gradient: "from-zinc-300 to-zinc-600" },
  { name: "Film",        key: "film",          f: { ...DEFAULT_FILTERS, brightness: 95, contrast: 90, saturation: 78, sharpness: 92 },                  serverFilter: "film", gradient: "from-amber-600 to-yellow-800" },
  { name: "HDR",         key: "hdr",           f: { ...DEFAULT_FILTERS, contrast: 145, saturation: 118, sharpness: 118 },                               serverFilter: "hdr", gradient: "from-cyan-500 to-blue-600" },
  { name: "Vintage",     key: "vintage",       f: { ...DEFAULT_FILTERS, brightness: 95, contrast: 90, saturation: 70, sharpness: 90 },                  serverFilter: "vintage", gradient: "from-amber-400 to-orange-700" },
  { name: "Cinematic",   key: "cinematic",     f: { ...DEFAULT_FILTERS, brightness: 96, contrast: 105, saturation: 85 },                                serverFilter: "cinematic", gradient: "from-teal-600 to-cyan-800" },
  { name: "Vibrant",     key: "vibrant",       f: { ...DEFAULT_FILTERS, brightness: 105, contrast: 110, saturation: 145, sharpness: 108 },              serverFilter: "vibrant", gradient: "from-fuchsia-500 to-pink-600" },
  { name: "Film Noir",   key: "filmnoir",      f: { ...DEFAULT_FILTERS, brightness: 90, contrast: 130, saturation: 0, sharpness: 112 },                 serverFilter: "filmnoir", gradient: "from-zinc-900 to-zinc-700" },
  { name: "Golden Hour", key: "goldenhour",    f: { ...DEFAULT_FILTERS, brightness: 106, saturation: 110 },                                             serverFilter: "goldenhour", gradient: "from-yellow-400 to-orange-500" },
  { name: "Moody",       key: "moody",         f: { ...DEFAULT_FILTERS, brightness: 92, contrast: 105, saturation: 75 },                                serverFilter: "moody", gradient: "from-indigo-800 to-purple-900" },
  { name: "Fresh",       key: "fresh",         f: { ...DEFAULT_FILTERS, brightness: 108, saturation: 115 },                                             serverFilter: "fresh", gradient: "from-green-400 to-emerald-500" },
  { name: "Retro",       key: "retro",         f: { ...DEFAULT_FILTERS, brightness: 98, contrast: 95, saturation: 65, sharpness: 90 },                  serverFilter: "retro", gradient: "from-orange-600 to-red-800" },
  { name: "Dramatic",    key: "dramatic",      f: { ...DEFAULT_FILTERS, brightness: 95, contrast: 140, saturation: 110, sharpness: 120 },               serverFilter: "dramatic", gradient: "from-red-700 to-zinc-900" },
  { name: "Warm Tone",   key: "warm_tone",     f: { ...DEFAULT_FILTERS, brightness: 105, saturation: 110, warmth: 20 },                                 serverFilter: "warm_tone", gradient: "from-orange-400 to-red-500" },
  { name: "Cool Tone",   key: "cool_tone",     f: { ...DEFAULT_FILTERS, brightness: 102, saturation: 95, warmth: -20 },                                 serverFilter: "cool_tone", gradient: "from-sky-400 to-blue-600" },
  { name: "Sunset",      key: "sunset",        f: { ...DEFAULT_FILTERS, brightness: 105, saturation: 120, warmth: 25 },                                 serverFilter: "sunset", gradient: "from-orange-500 to-pink-600" },
  { name: "Matte",       key: "matte",         f: { ...DEFAULT_FILTERS, brightness: 105, contrast: 85, saturation: 80 },                                serverFilter: "matte", gradient: "from-stone-400 to-stone-600" },
  { name: "Neon",        key: "neon",          f: { ...DEFAULT_FILTERS, contrast: 130, saturation: 160, sharpness: 115 },                               serverFilter: "neon", gradient: "from-violet-500 to-fuchsia-600" },
  // Premium filters
  { name: "Airy",        key: "airy",          f: { ...DEFAULT_FILTERS, brightness: 112, contrast: 90, saturation: 85 },                                serverFilter: "airy", gradient: "from-sky-200 to-blue-300", premium: true },
  { name: "Teal & Orange", key: "teal_orange", f: { ...DEFAULT_FILTERS, contrast: 115, saturation: 110 },                                              serverFilter: "teal_orange", gradient: "from-teal-500 to-orange-500", premium: true },
  { name: "Pastel",      key: "pastel",        f: { ...DEFAULT_FILTERS, brightness: 110, contrast: 85, saturation: 70 },                                serverFilter: "pastel", gradient: "from-pink-300 to-violet-300", premium: true },
  { name: "Noir Color",  key: "noir_color",    f: { ...DEFAULT_FILTERS, brightness: 92, contrast: 125, saturation: 60 },                                serverFilter: "noir_color", gradient: "from-zinc-800 to-amber-900", premium: true },
  { name: "Cross Process", key: "cross_process", f: { ...DEFAULT_FILTERS, contrast: 120, saturation: 130 },                                            serverFilter: "cross_process", gradient: "from-green-500 to-purple-600", premium: true },
  { name: "Cyberpunk",   key: "cyberpunk",     f: { ...DEFAULT_FILTERS, contrast: 130, saturation: 140 },                                               serverFilter: "cyberpunk", gradient: "from-cyan-400 to-fuchsia-600", premium: true },
  { name: "Arctic",      key: "arctic",        f: { ...DEFAULT_FILTERS, brightness: 108, contrast: 95, saturation: 75, warmth: -30 },                   serverFilter: "arctic", gradient: "from-cyan-200 to-blue-400", premium: true },
  { name: "Ember",       key: "ember",         f: { ...DEFAULT_FILTERS, brightness: 98, contrast: 115, saturation: 110, warmth: 30 },                   serverFilter: "ember", gradient: "from-orange-600 to-red-700", premium: true },
  { name: "Chrome",      key: "chrome",        f: { ...DEFAULT_FILTERS, brightness: 105, contrast: 120, saturation: 20, sharpness: 115 },               serverFilter: "chrome", gradient: "from-zinc-300 to-zinc-500", premium: true },
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

function buildCssFilter(f: FilterState): string {
  const blurPx = f.sharpness < 100 ? ((100 - f.sharpness) / 100) * 3 : 0;
  const hueRot = f.hue ?? 0;
  const warmthShift = f.warmth ?? 0;
  return [
    `brightness(${f.brightness}%)`,
    `contrast(${f.contrast}%)`,
    `saturate(${f.saturation}%)`,
    blurPx > 0 ? `blur(${blurPx.toFixed(2)}px)` : "",
    hueRot !== 0 ? `hue-rotate(${hueRot}deg)` : "",
    warmthShift > 0 ? `sepia(${Math.min(warmthShift * 2, 50)}%)` : "",
  ].filter(Boolean).join(" ");
}

function buildPreviewStyle(
  transform: TransformState,
  filters: FilterState,
  crop: CropBox,
): React.CSSProperties {
  const t: string[] = [];
  if (transform.rotation) t.push(`rotate(${transform.rotation}deg)`);
  if (transform.flipH) t.push("scaleX(-1)");
  if (transform.flipV) t.push("scaleY(-1)");
  const { x, y, x2, y2 } = crop;
  const hasCrop = x !== 0 || y !== 0 || x2 !== 100 || y2 !== 100;
  return {
    filter: buildCssFilter(filters),
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
        ctx.filter = buildCssFilter(filters);
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
  { title: "Pick a Style",       description: "Choose from 15+ filter presets or use AI-powered enhancements. In Simple mode, just tap a preset for instant results.", icon: <Palette className="w-8 h-8 text-purple-400" /> },
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
  // Onboarding
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem(ONBOARDING_KEY));
  const completeOnboarding = () => { localStorage.setItem(ONBOARDING_KEY, "1"); setShowOnboarding(false); };

  // Mode toggle
  const [editorMode, setEditorMode] = useState<EditorMode>("simple");

  // Media state
  const [file, setFile] = useState<File | null>(null);
  const [base64Data, setBase64Data] = useState<string>("");
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [mediaType, setMediaType] = useState<UploadMediaBodyMediaType>("photo");
  const [enhancementType, setEnhancementType] = useState<EnhanceMediaBodyEnhancementType>("auto");
  const [selectedFilter, setSelectedFilter] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<number | undefined>(undefined);
  const [currentJobId, setCurrentJobId] = useState<number | null>(null);
  const [processStage, setProcessStage] = useState<ProcessStage>("idle");

  // Advanced controls
  const [transform, setTransform] = useState<TransformState>(DEFAULT_TRANSFORM);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [cropBox, setCropBox] = useState<CropBox>(DEFAULT_CROP);
  const [cropEnabled, setCropEnabled] = useState(false);
  const [stabilize, setStabilize] = useState(false);
  const [denoise, setDenoise] = useState(false);
  const [skinSmoothing, setSkinSmoothing] = useState(50);

  // AI Analysis
  const [aiSuggestion, setAiSuggestion] = useState<AISuggestion | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showCompare, setShowCompare] = useState(false);

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
  const { data: currentJob } = useGetMediaJob(currentJobId as number, {
    query: {
      enabled: !!currentJobId,
      queryKey: ["mediaJob", currentJobId],
      refetchInterval: (query) => {
        const s = query.state.data?.status;
        if (s === "completed" || s === "failed") return false;
        return 2000;
      },
    },
  });

  // Track the uploaded job ID for AI analysis (set after upload, before enhance)
  const uploadedJobIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!currentJob) return;
    if (currentJob.status === "completed" && processStage !== "completed") {
      setProcessStage("completed");
      toast({ title: "Enhancement complete!", description: "Your media has been successfully enhanced." });
    } else if (currentJob.status === "failed" && processStage !== "failed") {
      setProcessStage("failed");
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

    let finalBase64 = base64Data;
    const hasT = transform.rotation !== 0 || transform.flipH || transform.flipV;
    const hasF = filters.brightness !== 100 || filters.contrast !== 100 || filters.saturation !== 100 || filters.sharpness !== 100;
    const hasC = cropEnabled && (cropBox.x !== 0 || cropBox.y !== 0 || cropBox.x2 !== 100 || cropBox.y2 !== 100);

    if (editorMode === "advanced" && mediaType === "photo" && (hasT || hasF || hasC)) {
      try {
        finalBase64 = await applyTransformsToBase64(file, transform, cropEnabled ? cropBox : DEFAULT_CROP, filters);
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

  const resetAll = () => {
    setFile(null); setPreviewUrl(""); setBase64Data("");
    setCurrentJobId(null); setProcessStage("idle");
    setTransform(DEFAULT_TRANSFORM); setFilters(DEFAULT_FILTERS);
    setCropBox(DEFAULT_CROP); setCropEnabled(false);
    setStabilize(false); setDenoise(false);
    setSelectedFilter(null); setAiSuggestion(null);
    setSkinSmoothing(50); uploadedJobIdRef.current = null;
    setUndoStack([]); setChatMessages([]); setShowAiChat(false);
  };

  const isProcessing = processStage === "uploading" || processStage === "processing";
  const isCompleted = processStage === "completed";
  const hasEdits = transform.rotation !== 0 || transform.flipH || transform.flipV
    || filters.brightness !== 100 || filters.contrast !== 100 || filters.saturation !== 100 || filters.sharpness !== 100
    || filters.warmth !== 0 || filters.highlights !== 0 || filters.shadows !== 0 || filters.hue !== 0
    || (cropEnabled && (cropBox.x !== 0 || cropBox.y !== 0 || cropBox.x2 !== 100 || cropBox.y2 !== 100));

  const previewStyle = buildPreviewStyle(transform, filters, cropEnabled ? cropBox : DEFAULT_CROP);
  const stageInfo = STAGE_INFO[processStage];

  const visibleFilters = showAllFilters ? FILTER_PRESETS : FILTER_PRESETS.slice(0, 12);

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
  ];

  return (
    <Layout>
      <TooltipProvider delayDuration={200}>
        {showOnboarding && <OnboardingWalkthrough onComplete={completeOnboarding} />}

        <div className="flex flex-col lg:flex-row h-full min-h-[calc(100vh-4rem)]">

          {/* Sidebar */}
          <aside className="w-full lg:w-80 xl:w-96 border-r border-white/10 bg-zinc-950 flex flex-col">
            <div className="p-4 border-b border-white/10">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-lg flex items-center gap-2">
                  <Settings2 className="w-5 h-5 text-teal-500" />
                  Editor
                </h2>
                <button onClick={() => setShowOnboarding(true)} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors" title="Show walkthrough">?</button>
              </div>
              {/* Mode toggle */}
              <div className="flex bg-zinc-900 rounded-lg p-0.5">
                <button className={cn("flex-1 text-xs font-medium py-1.5 px-3 rounded-md transition-all", editorMode === "simple" ? "bg-teal-600 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-300")} onClick={() => setEditorMode("simple")}>
                  <Zap className="w-3 h-3 inline mr-1" />Simple
                </button>
                <button className={cn("flex-1 text-xs font-medium py-1.5 px-3 rounded-md transition-all", editorMode === "advanced" ? "bg-teal-600 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-300")} onClick={() => setEditorMode("advanced")}>
                  <SlidersHorizontal className="w-3 h-3 inline mr-1" />Advanced
                </button>
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-4">

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
                        <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3 flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center shrink-0">
                            <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
                          </div>
                          <div>
                            <p className="text-xs font-medium text-purple-300">AI is analyzing your image...</p>
                            <p className="text-[10px] text-purple-400/60">Finding the best enhancement</p>
                          </div>
                        </div>
                      ) : aiSuggestion && (
                        <div className="rounded-xl border border-purple-500/30 bg-gradient-to-r from-purple-500/10 to-fuchsia-500/10 p-3">
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0 mt-0.5">
                              <ScanEye className="w-4 h-4 text-purple-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="text-xs font-medium text-purple-200">AI Recommendation</p>
                                <Badge variant="outline" className="text-[8px] border-purple-500/40 text-purple-300 px-1.5 py-0 h-3.5 capitalize">
                                  {inferImageType(aiSuggestion.detectedSubjects)}
                                </Badge>
                              </div>
                              <p className="text-[11px] text-zinc-400 leading-relaxed mb-2 line-clamp-2">{aiSuggestion.description}</p>
                              <div className="flex flex-wrap gap-1 mb-2">
                                {aiSuggestion.detectedSubjects.slice(0, 4).map((s) => (
                                  <Badge key={s} variant="outline" className="text-[9px] border-purple-500/30 text-purple-300 px-1.5 py-0 h-4">{s}</Badge>
                                ))}
                              </div>
                              <Button size="sm" className="h-7 text-xs bg-purple-600 hover:bg-purple-700 text-white w-full" onClick={applyAiSuggestion}>
                                <Sparkles className="w-3 h-3 mr-1" />
                                Apply Best: {aiSuggestion.suggestedEnhancement}
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
                                    <p className="text-[9px] text-zinc-600 mb-1.5">Or try:</p>
                                    <div className="flex flex-wrap gap-1">
                                      {alts.map(a => (
                                        <button
                                          key={a.type}
                                          onClick={() => applyAlternative(a.type)}
                                          className="text-[9px] px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-400 hover:border-teal-500 hover:text-teal-300 transition-colors"
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
                          <div className="mt-2 flex items-center justify-between">
                            <span className="text-[9px] text-zinc-600">Confidence: {Math.round(aiSuggestion.confidence * 100)}%</span>
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
                              className="text-[9px] text-zinc-600 hover:text-zinc-400"
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
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Quick Enhance</Label>
                      <div className="grid grid-cols-2 gap-2">
                        {SIMPLE_PRESETS.map((p) => (
                          <Tooltip key={p.type + (p.filterName ?? "")}>
                            <TooltipTrigger asChild>
                              <motion.button
                                whileTap={{ scale: 0.97 }}
                                className={cn(
                                  "flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all text-center",
                                  enhancementType === p.type && !selectedFilter
                                    ? "border-teal-500 bg-teal-500/10 shadow-lg shadow-teal-500/10"
                                    : "border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 hover:border-zinc-700",
                                )}
                                onClick={() => {
                                  pushUndo();
                                  setEnhancementType(p.type);
                                  setSelectedFilter(null);
                                  // Instant CSS preview for certain types
                                  if (p.type === "color_grade_warm") setFilters({ ...DEFAULT_FILTERS, warmth: 20, saturation: 110 });
                                  else if (p.type === "color_grade_cool") setFilters({ ...DEFAULT_FILTERS, warmth: -20, saturation: 95 });
                                  else if (p.type === "color_grade_cinematic") setFilters({ ...DEFAULT_FILTERS, brightness: 96, contrast: 105, saturation: 85 });
                                  else if (p.type === "lighting_enhance") setFilters({ ...DEFAULT_FILTERS, brightness: 108, contrast: 110 });
                                  else if (p.type === "portrait") setFilters({ ...DEFAULT_FILTERS, brightness: 105, contrast: 95, saturation: 88 });
                                  else setFilters(DEFAULT_FILTERS);
                                }}
                              >
                                <div className={cn(
                                  "w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                                  enhancementType === p.type && !selectedFilter ? "bg-teal-500/20 text-teal-400" : "bg-zinc-800 text-zinc-400",
                                )}>
                                  {p.icon}
                                </div>
                                <p className="text-[11px] font-medium leading-tight">{p.label}</p>
                              </motion.button>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="text-xs">{p.desc}</TooltipContent>
                          </Tooltip>
                        ))}
                      </div>
                    </div>

                    <Separator className="bg-white/5" />

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Filter Gallery</Label>
                        <button onClick={() => setShowAllFilters(!showAllFilters)} className="text-[10px] text-teal-500 hover:text-teal-400">
                          {showAllFilters ? "Show less" : `All ${FILTER_PRESETS.length}`}
                        </button>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {visibleFilters.map((p) => (
                          <Tooltip key={p.key}>
                            <TooltipTrigger asChild>
                              <motion.button
                                whileTap={{ scale: 0.95 }}
                                className={cn(
                                  "relative rounded-lg border transition-all overflow-hidden h-14 group",
                                  selectedFilter === p.key ? "border-teal-500 ring-1 ring-teal-500/30" : "border-zinc-800 hover:border-zinc-600",
                                )}
                                onClick={() => {
                                  pushUndo();
                                  setSelectedFilter(p.key === "original" ? null : p.key);
                                  setFilters(p.f);
                                  if (p.serverFilter) setEnhancementType("filter");
                                }}
                              >
                                <div className={cn("absolute inset-0 bg-gradient-to-br opacity-60", p.gradient)} />
                                <div className="absolute inset-0 flex items-end p-1">
                                  <span className="text-[9px] font-medium text-white drop-shadow-lg leading-tight">{p.name}</span>
                                </div>
                                {p.premium && (
                                  <div className="absolute top-0.5 right-0.5">
                                    <div className="w-2 h-2 rounded-full bg-amber-400" />
                                  </div>
                                )}
                                {selectedFilter === p.key && (
                                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute top-0.5 left-0.5">
                                    <CheckCircle2 className="w-3 h-3 text-teal-400" />
                                  </motion.div>
                                )}
                              </motion.button>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="text-xs">
                              {p.name}{p.premium ? " (Premium)" : ""}
                            </TooltipContent>
                          </Tooltip>
                        ))}
                      </div>
                    </div>

                    {mediaType === "video" && (
                      <>
                        <Separator className="bg-white/5" />
                        <div className="space-y-3">
                          <Label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Video Options</Label>
                          <div className="flex items-center justify-between p-3 rounded-lg border border-zinc-800 bg-zinc-900/50">
                            <div>
                              <p className="text-sm font-medium">AI Stabilization</p>
                              <p className="text-xs text-zinc-500 mt-0.5">Remove camera shake</p>
                            </div>
                            <Switch checked={stabilize} onCheckedChange={setStabilize} />
                          </div>
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
                          {ENHANCEMENT_TYPES.map(({ type, label, icon }) => (
                            <Button key={type} variant="outline" size="sm"
                              className={cn("justify-start gap-2 border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 h-8 text-xs",
                                enhancementType === type && "border-teal-500 text-teal-400 bg-teal-500/10 hover:bg-teal-500/20")}
                              onClick={() => setEnhancementType(type)}>
                              {icon}{label}
                            </Button>
                          ))}
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
                          {FILTER_PRESETS.map((p) => (
                            <button key={p.key}
                              className={cn(
                                "relative rounded-lg border transition-all overflow-hidden h-12",
                                selectedFilter === p.key ? "border-teal-500 ring-1 ring-teal-500/30" : "border-zinc-800 hover:border-zinc-600",
                              )}
                              onClick={() => { pushUndo(); setFilters(p.f); setSelectedFilter(p.key === "original" ? null : p.key); }}>
                              <div className={cn("absolute inset-0 bg-gradient-to-br opacity-60", p.gradient)} />
                              <div className="absolute inset-0 flex items-end p-1">
                                <span className="text-[8px] font-medium text-white drop-shadow-lg">{p.name}</span>
                              </div>
                              {p.premium && <div className="absolute top-0.5 right-0.5"><div className="w-1.5 h-1.5 rounded-full bg-amber-400" /></div>}
                            </button>
                          ))}
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
                        <div className="flex items-center justify-between p-3 rounded-lg border border-zinc-800 bg-zinc-900/50">
                          <div>
                            <p className="text-sm font-medium">AI Stabilization</p>
                            <p className="text-xs text-zinc-500 mt-0.5">Remove camera shake with AI</p>
                          </div>
                          <Switch checked={stabilize} onCheckedChange={setStabilize} />
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-lg border border-zinc-800 bg-zinc-900/50">
                          <div>
                            <p className="text-sm font-medium">Noise Reduction</p>
                            <p className="text-xs text-zinc-500 mt-0.5">Reduce grain &amp; video noise</p>
                          </div>
                          <Switch checked={denoise} onCheckedChange={setDenoise} />
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-lg border border-zinc-800 bg-zinc-900/50">
                          <div>
                            <p className="text-sm font-medium">Cinematic Preset</p>
                            <p className="text-xs text-zinc-500 mt-0.5">Film-grade color grading</p>
                          </div>
                          <Switch checked={selectedFilter === "cinematic"} onCheckedChange={(v) => setSelectedFilter(v ? "cinematic" : null)} />
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
            <div className="p-4 border-t border-white/10 space-y-3">
              <AnimatePresence>
                {processStage !== "idle" && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                    className={cn("flex items-center gap-2 text-sm", stageInfo.colorClass)}>
                    {(processStage === "uploading" || processStage === "processing") && <Loader2 className="w-4 h-4 animate-spin" />}
                    {processStage === "completed" && <CheckCircle2 className="w-4 h-4" />}
                    {processStage === "failed"    && <AlertCircle  className="w-4 h-4" />}
                    <span>{stageInfo.label}</span>
                    {processStage === "uploading"  && <span className="text-xs text-zinc-500 ml-auto">step 1/2</span>}
                    {processStage === "processing" && <span className="text-xs text-zinc-500 ml-auto">step 2/2</span>}
                  </motion.div>
                )}
              </AnimatePresence>
              <Button
                className="w-full bg-teal-600 hover:bg-teal-700 text-white shadow-lg shadow-teal-500/20 h-11"
                onClick={handleProcess}
                disabled={!file || isProcessing}
              >
                {isProcessing
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing...</>
                  : <><Wand2   className="w-4 h-4 mr-2" />{isCompleted ? "Enhance Again" : "Enhance Media"}</>
                }
              </Button>
            </div>
          </aside>

          {/* Main Preview */}
          <main className="flex-1 bg-zinc-900 relative flex flex-col">
            <div className="flex-1 flex items-center justify-center p-8 overflow-hidden">
              {!file ? (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-lg w-full">
                  <Card className="border-dashed border-2 border-zinc-800 bg-zinc-950/50 hover:bg-zinc-900/50 hover:border-zinc-700 transition-all cursor-pointer relative overflow-hidden group">
                    <input type="file" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      accept="image/*,video/*" onChange={handleFileChange} />
                    <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                      <motion.div
                        animate={{ y: [0, -6, 0] }}
                        transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                        className="w-20 h-20 bg-gradient-to-br from-teal-500/20 to-purple-500/20 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform"
                      >
                        <UploadCloud className="w-10 h-10 text-teal-400" />
                      </motion.div>
                      <h3 className="text-xl font-bold mb-2">Upload Media</h3>
                      <p className="text-zinc-500 text-sm mb-1">Drag &amp; drop or click to browse</p>
                      <p className="text-zinc-600 text-xs mb-6">AI will analyze and suggest the best enhancement</p>
                      <div className="flex items-center gap-6 text-xs text-zinc-600">
                        <span className="flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5" /> Photos up to {MAX_FILE_MB} MB</span>
                        <span className="flex items-center gap-1.5"><Video className="w-3.5 h-3.5" /> Videos up to {MAX_FILE_MB} MB</span>
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
                      {(chatMessages.length > 0 || isAnalyzing) && (
                        <Button variant="outline" size="sm"
                          onClick={() => setShowAiChat(v => !v)}
                          className={cn(
                            "bg-black/50 backdrop-blur border-white/10 hover:bg-white/10 text-xs h-8 gap-1.5",
                            showAiChat && "border-purple-500 text-purple-300"
                          )}>
                          <MessageSquare className="w-3.5 h-3.5" />
                          AI{isAnalyzing && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                        </Button>
                      )}
                      {isCompleted && (
                        <Button variant="outline" size="sm"
                          className={cn("bg-black/50 backdrop-blur border-white/10 hover:bg-white/10 text-xs h-8", showCompare && "border-purple-500 text-purple-300")}
                          onMouseDown={() => setShowCompare(true)}
                          onMouseUp={() => setShowCompare(false)}
                          onMouseLeave={() => setShowCompare(false)}
                          onTouchStart={() => setShowCompare(true)}
                          onTouchEnd={() => setShowCompare(false)}
                        >
                          <Eye className="w-3.5 h-3.5 mr-1.5" />Hold to compare
                        </Button>
                      )}
                    </div>
                    {isCompleted && currentJob?.processedUrl && (
                      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
                        <a href={currentJob.processedUrl} download={`enhanced-${file?.name ?? "image.jpg"}`}>
                          <Button size="sm" className="bg-white text-black hover:bg-white/90 shadow-lg h-9 px-5 font-semibold text-xs">
                            <Download className="w-4 h-4 mr-2" />Export
                          </Button>
                        </a>
                      </motion.div>
                    )}
                  </div>

                  {/* Image preview */}
                  <div className="relative max-w-full rounded-xl overflow-hidden border border-white/10 shadow-2xl bg-black flex items-center justify-center">
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
                          <p className="text-lg font-semibold">{processStage === "uploading" ? "Uploading..." : "Applying AI Magic..."}</p>
                          <p className="text-sm text-zinc-400 mt-1">This may take a few moments</p>
                          <div className="mt-4 w-48 h-1 bg-zinc-800 rounded-full overflow-hidden">
                            <motion.div
                              className="h-full bg-gradient-to-r from-teal-500 to-purple-500 rounded-full"
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
                            className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-purple-400 to-transparent shadow-[0_0_12px_4px_rgba(168,85,247,0.4)]"
                            animate={{ top: ["0%", "100%", "0%"] }}
                            transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut" }}
                          />
                          {/* Corner brackets */}
                          <div className="absolute top-2 left-2 w-5 h-5 border-t-2 border-l-2 border-purple-400/60 rounded-tl" />
                          <div className="absolute top-2 right-2 w-5 h-5 border-t-2 border-r-2 border-purple-400/60 rounded-tr" />
                          <div className="absolute bottom-2 left-2 w-5 h-5 border-b-2 border-l-2 border-purple-400/60 rounded-bl" />
                          <div className="absolute bottom-2 right-2 w-5 h-5 border-b-2 border-r-2 border-purple-400/60 rounded-br" />
                          {/* Label */}
                          <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-black/70 backdrop-blur px-3 py-1 rounded-full">
                            <ScanEye className="w-3 h-3 text-purple-400" />
                            <span className="text-[10px] font-medium text-purple-300">AI Scanning</span>
                            <Loader2 className="w-2.5 h-2.5 text-purple-400 animate-spin" />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {isCompleted && currentJob?.processedUrl && !showCompare ? (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                        {mediaType === "video"
                          ? <video src={currentJob.processedUrl} controls autoPlay loop muted className="max-w-full max-h-[80vh] object-contain" />
                          : <img src={currentJob.processedUrl} alt="Enhanced" className="max-w-full max-h-[80vh] object-contain" />
                        }
                      </motion.div>
                    ) : (
                      mediaType === "video"
                        ? <video src={previewUrl} controls className="max-w-full max-h-[80vh] object-contain" />
                        : <img src={previewUrl} alt="Original"
                            className="max-w-full max-h-[80vh] object-contain transition-all duration-200"
                            style={isProcessing ? { opacity: 0.5 } : previewStyle} />
                    )}
                  </div>

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
                    {selectedFilter && <><span>&#8226;</span><span className="text-purple-400">Filter: {selectedFilter}</span></>}
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
                        <div className="rounded-xl border border-purple-500/20 bg-zinc-950/80 backdrop-blur p-4 space-y-3">
                          {isAnalyzing ? (
                            <div className="flex items-center gap-3 justify-center py-3">
                              <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
                              <span className="text-sm text-purple-300">Scanning image with AI...</span>
                            </div>
                          ) : aiSuggestion ? (
                            <>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <ScanEye className="w-4 h-4 text-purple-400" />
                                  <span className="text-sm font-semibold text-purple-200">AI Recommends</span>
                                  <Badge variant="outline" className="text-[9px] border-purple-500/40 text-purple-300 px-1.5 py-0 h-4 capitalize">
                                    {inferImageType(aiSuggestion.detectedSubjects)}
                                  </Badge>
                                </div>
                                <span className="text-[10px] text-zinc-600">{Math.round(aiSuggestion.confidence * 100)}% confident</span>
                              </div>
                              <p className="text-xs text-zinc-400 leading-relaxed">{aiSuggestion.description}</p>
                              <div className="flex flex-wrap gap-1">
                                {aiSuggestion.detectedSubjects.slice(0, 5).map(s => (
                                  <Badge key={s} variant="outline" className="text-[9px] border-purple-500/30 text-purple-300 px-1.5 py-0 h-4">{s}</Badge>
                                ))}
                              </div>
                              <div className="flex items-center gap-2">
                                <Button size="sm" className="flex-1 h-8 text-xs bg-purple-600 hover:bg-purple-700 text-white" onClick={applyAiSuggestion}>
                                  <Sparkles className="w-3 h-3 mr-1" />
                                  Apply: {aiSuggestion.suggestedEnhancement}
                                </Button>
                                <button
                                  onClick={() => setShowPowerUp(false)}
                                  className="text-xs text-zinc-600 hover:text-zinc-400 px-2"
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
                                    <p className="text-[10px] text-zinc-600 mb-1.5">Other options:</p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {alts.map(a => (
                                        <button
                                          key={a.type}
                                          onClick={() => { applyAlternative(a.type); setShowPowerUp(false); }}
                                          className="text-[10px] px-2.5 py-1 rounded-full border border-zinc-700 text-zinc-400 hover:border-purple-500 hover:text-purple-300 transition-colors"
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
                          ? "border-purple-500/40 bg-purple-500/10 text-purple-300"
                          : "border-zinc-700 bg-zinc-900/80 text-zinc-400 hover:border-purple-500/30 hover:text-purple-300 hover:bg-purple-500/5",
                      )}
                    >
                      <Zap className="w-3.5 h-3.5" />
                      AI Power-Up
                      {isAnalyzing && <Loader2 className="w-3 h-3 animate-spin" />}
                      {aiSuggestion && !showPowerUp && <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />}
                    </motion.button>
                  )}
                </div>
              )}
            </div>
            {/* AI Chat Panel */}
            <AnimatePresence>
              {showAiChat && (
                <motion.div
                  initial={{ opacity: 0, x: 320 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 320 }}
                  transition={{ type: "spring", damping: 25, stiffness: 200 }}
                  className="absolute right-0 top-0 bottom-0 w-80 bg-zinc-950/95 backdrop-blur border-l border-white/10 flex flex-col z-30 shadow-2xl"
                >
                  {/* Chat header */}
                  <div className="p-4 border-b border-white/10 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-purple-500/20 flex items-center justify-center">
                        <Sparkles className="w-3.5 h-3.5 text-purple-400" />
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
                          <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0 mt-0.5">
                            <Loader2 className="w-3 h-3 text-purple-400 animate-spin" />
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
                            msg.role === "ai" ? "bg-purple-500/20 text-purple-400" : "bg-teal-500/20 text-teal-400"
                          )}>
                            {msg.role === "ai" ? <Sparkles className="w-3 h-3" /> : "U"}
                          </div>
                          <div className={cn(
                            "max-w-[220px] rounded-xl px-3 py-2 text-xs leading-relaxed",
                            msg.role === "ai"
                              ? "bg-zinc-900 border border-zinc-800 rounded-tl-none text-zinc-300"
                              : "bg-teal-600/20 border border-teal-500/20 rounded-tr-none text-teal-100"
                          )}>
                            <p>{msg.text}</p>
                            {msg.action && !msg.applied && msg.role === "ai" && (
                              <div className="mt-2 pt-2 border-t border-white/5 space-y-1.5">
                                <p className="text-[10px] text-zinc-500">
                                  Suggested: <span className="text-purple-300 capitalize">{msg.action.type}</span>
                                  {msg.action.filter && <> · <span className="text-amber-300 capitalize">{msg.action.filter}</span></>}
                                </p>
                                <Button
                                  size="sm"
                                  className="w-full h-6 text-[10px] bg-purple-600 hover:bg-purple-700 text-white"
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
                        <div className="text-center py-8 text-zinc-600 text-xs">
                          Upload a photo to get AI recommendations
                        </div>
                      )}
                    </div>
                  </ScrollArea>

                  {/* Chat input */}
                  <div className="p-3 border-t border-white/10 shrink-0">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const txt = chatInput.trim();
                        if (!txt) return;
                        const userId = ++chatIdRef.current;
                        setChatMessages(prev => [...prev, { id: userId, role: "user", text: txt }]);
                        setChatInput("");
                        // Auto-reply with current suggestion if any
                        setTimeout(() => {
                          const replyId = ++chatIdRef.current;
                          if (aiSuggestion) {
                            setChatMessages(prev => [...prev, {
                              id: replyId,
                              role: "ai",
                              text: `I recommend ${aiSuggestion.suggestedEnhancement} for your image. ${aiSuggestion.description}`,
                              action: {
                                type: aiSuggestion.suggestedEnhancement as EnhanceMediaBodyEnhancementType,
                                filter: aiSuggestion.suggestedFilter ?? undefined,
                              },
                            }]);
                          } else {
                            setChatMessages(prev => [...prev, {
                              id: replyId,
                              role: "ai",
                              text: "Upload an image first so I can analyze and suggest the best enhancement for you.",
                            }]);
                          }
                        }, 600);
                      }}
                      className="flex items-center gap-2"
                    >
                      <Input
                        value={chatInput}
                        onChange={e => setChatInput(e.target.value)}
                        placeholder="Ask me anything..."
                        className="flex-1 h-8 text-xs bg-zinc-900 border-zinc-700 focus-visible:ring-purple-500"
                      />
                      <Button type="submit" size="sm" className="h-8 w-8 p-0 bg-purple-600 hover:bg-purple-700 shrink-0">
                        <Send className="w-3.5 h-3.5" />
                      </Button>
                    </form>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </main>
        </div>
      </TooltipProvider>
    </Layout>
  );
}