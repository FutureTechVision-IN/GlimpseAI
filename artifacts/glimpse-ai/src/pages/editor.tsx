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
} from "lucide-react";

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

  const { toast } = useToast();
  const uploadMedia = useUploadMedia();
  const enhanceMedia = useEnhanceMedia();
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
    const reader = new FileReader();
    reader.onload = (ev) => setBase64Data((ev.target?.result as string).split(",")[1]);
    reader.readAsDataURL(sel);
  };

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

    // Video stabilize
    if (mediaType === "video" && stabilize) {
      effectiveType = "stabilize" as EnhanceMediaBodyEnhancementType;
    }

    let finalBase64 = base64Data;
    const hasT = transform.rotation !== 0 || transform.flipH || transform.flipV;
    const hasF = Object.values(filters).some((v) => v !== 100);
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
  }, [file, base64Data, enhancementType, mediaType, transform, filters, cropBox, cropEnabled, stabilize, presetId, editorMode, selectedFilter]);

  const resetAll = () => {
    setFile(null); setPreviewUrl(""); setBase64Data("");
    setCurrentJobId(null); setProcessStage("idle");
    setTransform(DEFAULT_TRANSFORM); setFilters(DEFAULT_FILTERS);
    setCropBox(DEFAULT_CROP); setCropEnabled(false);
    setStabilize(false); setDenoise(false);
    setSelectedFilter(null);
  };

  const isProcessing = processStage === "uploading" || processStage === "processing";
  const isCompleted = processStage === "completed";
  const hasEdits = transform.rotation !== 0 || transform.flipH || transform.flipV
    || Object.values(filters).some((v) => v !== 100)
    || (cropEnabled && (cropBox.x !== 0 || cropBox.y !== 0 || cropBox.x2 !== 100 || cropBox.y2 !== 100));

  const previewStyle = buildPreviewStyle(transform, filters, cropEnabled ? cropBox : DEFAULT_CROP);
  const stageInfo = STAGE_INFO[processStage];

  const ENHANCEMENT_TYPES: { type: EnhanceMediaBodyEnhancementType; label: string; icon: React.ReactNode }[] = [
    { type: "auto",       label: "Auto",       icon: <Wand2    className="w-3 h-3" /> },
    { type: "upscale",    label: "Upscale",    icon: <ZoomIn   className="w-3 h-3" /> },
    { type: "portrait",   label: "Portrait",   icon: <Sparkles className="w-3 h-3" /> },
    { type: "color",      label: "Color",      icon: <Palette  className="w-3 h-3" /> },
    { type: "lighting",   label: "Lighting",   icon: <Sun      className="w-3 h-3" /> },
    { type: "beauty",     label: "Beauty",     icon: <Eye      className="w-3 h-3" /> },
    { type: "background", label: "Background", icon: <Camera   className="w-3 h-3" /> },
    { type: "filter",     label: "Filter",     icon: <Film     className="w-3 h-3" /> },
  ];

  return (
    <Layout>
      {showOnboarding && <OnboardingWalkthrough onComplete={completeOnboarding} />}

      <div className="flex flex-col lg:flex-row h-full min-h-[calc(100vh-4rem)]">

        {/* Sidebar */}
        <aside className="w-full lg:w-80 border-r border-white/10 bg-zinc-950 flex flex-col">
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

              {/* SIMPLE MODE */}
              {editorMode === "simple" && (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Quick Enhance</Label>
                    <div className="space-y-2">
                      {SIMPLE_PRESETS.map((p) => (
                        <button key={p.type + (p.filterName ?? "")}
                          className={cn("w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left",
                            enhancementType === p.type && !selectedFilter ? "border-teal-500 bg-teal-500/10" : "border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 hover:border-zinc-700")}
                          onClick={() => { setEnhancementType(p.type); setSelectedFilter(null); }}>
                          <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">{p.icon}</div>
                          <div>
                            <p className="text-sm font-medium">{p.label}</p>
                            <p className="text-xs text-zinc-500">{p.desc}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <Separator className="bg-white/5" />

                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Filter Gallery</Label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {FILTER_PRESETS.map((p) => (
                        <button key={p.key}
                          className={cn("text-xs py-2 px-1 rounded-md border transition-all font-medium",
                            selectedFilter === p.key ? "border-teal-500 text-teal-400 bg-teal-500/10" : "border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 text-zinc-300")}
                          onClick={() => {
                            setSelectedFilter(p.key === "original" ? null : p.key);
                            setFilters(p.f);
                            if (p.serverFilter) setEnhancementType("filter");
                          }}>
                          {p.name}
                        </button>
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
                  <TabsList className="grid grid-cols-4 w-full bg-zinc-900 mb-4 h-9">
                    <TabsTrigger value="enhance"   className="text-xs px-1 gap-1"><Wand2              className="w-3 h-3" />AI</TabsTrigger>
                    <TabsTrigger value="transform" className="text-xs px-1 gap-1"><RotateCw           className="w-3 h-3" />Xform</TabsTrigger>
                    <TabsTrigger value="filters"   className="text-xs px-1 gap-1"><SlidersHorizontal  className="w-3 h-3" />Filters</TabsTrigger>
                    {mediaType === "video"
                      ? <TabsTrigger value="video" className="text-xs px-1 gap-1"><Film className="w-3 h-3" />Video</TabsTrigger>
                      : <TabsTrigger value="crop"  className="text-xs px-1 gap-1"><Crop className="w-3 h-3" />Crop</TabsTrigger>
                    }
                  </TabsList>

                  {/* AI Enhance */}
                  <TabsContent value="enhance" className="space-y-5 mt-0">
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Enhancement Type</Label>
                      <div className="grid grid-cols-2 gap-2">
                        {ENHANCEMENT_TYPES.map(({ type, label, icon }) => (
                          <Button key={type} variant="outline" size="sm"
                            className={cn("justify-start gap-2 border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800",
                              enhancementType === type && "border-teal-500 text-teal-400 bg-teal-500/10 hover:bg-teal-500/20")}
                            onClick={() => setEnhancementType(type)}>
                            {icon}{label}
                          </Button>
                        ))}
                      </div>
                    </div>
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

                  {/* Transform */}
                  <TabsContent value="transform" className="space-y-5 mt-0">
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Rotate</Label>
                      <div className="grid grid-cols-2 gap-2">
                        <Button variant="outline" size="sm" className="gap-2 border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800"
                          onClick={() => setTransform((t) => ({ ...t, rotation: (t.rotation - 90 + 360) % 360 }))}>
                          <RotateCcw className="w-3.5 h-3.5" />CCW
                        </Button>
                        <Button variant="outline" size="sm" className="gap-2 border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800"
                          onClick={() => setTransform((t) => ({ ...t, rotation: (t.rotation + 90) % 360 }))}>
                          <RotateCw className="w-3.5 h-3.5" />CW
                        </Button>
                      </div>
                      {transform.rotation !== 0 && (
                        <p className="text-xs text-zinc-500 text-center">{transform.rotation} deg applied</p>
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
                      <div className="grid grid-cols-3 gap-1.5">
                        {FILTER_PRESETS.map((p) => (
                          <Button key={p.key} variant="outline" size="sm"
                            className={cn("border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 text-xs h-8",
                              selectedFilter === p.key && "border-teal-500 text-teal-400 bg-teal-500/10",
                              !selectedFilter && JSON.stringify(filters) === JSON.stringify(p.f) && "border-teal-500 text-teal-400 bg-teal-500/10")}
                            onClick={() => { setFilters(p.f); setSelectedFilter(p.key === "original" ? null : p.key); }}>{p.name}</Button>
                        ))}
                      </div>
                    </div>
                    <Separator className="bg-white/5" />
                    {(["brightness", "contrast", "saturation", "sharpness"] as const).map((key) => (
                      <div key={key} className="space-y-2">
                        <div className="flex justify-between">
                          <Label className="text-xs text-zinc-400 capitalize">{key}</Label>
                          <span className="text-xs text-zinc-500 tabular-nums">{filters[key]}</span>
                        </div>
                        <Slider min={0} max={200} step={1} value={[filters[key]]}
                          onValueChange={([v]) => setFilters((f) => ({ ...f, [key]: v }))} />
                      </div>
                    ))}
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
            {processStage !== "idle" && (
              <div className={cn("flex items-center gap-2 text-sm", stageInfo.colorClass)}>
                {(processStage === "uploading" || processStage === "processing") && <Loader2 className="w-4 h-4 animate-spin" />}
                {processStage === "completed" && <CheckCircle2 className="w-4 h-4" />}
                {processStage === "failed"    && <AlertCircle  className="w-4 h-4" />}
                <span>{stageInfo.label}</span>
                {processStage === "uploading"  && <span className="text-xs text-zinc-500 ml-auto">step 1/2</span>}
                {processStage === "processing" && <span className="text-xs text-zinc-500 ml-auto">step 2/2</span>}
              </div>
            )}
            <Button
              className="w-full bg-teal-600 hover:bg-teal-700 text-white shadow-lg shadow-teal-500/20"
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
              <div className="max-w-md w-full">
                <Card className="border-dashed border-2 border-zinc-800 bg-zinc-950/50 hover:bg-zinc-900/50 hover:border-zinc-700 transition-colors cursor-pointer relative overflow-hidden group">
                  <input type="file" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    accept="image/*,video/*" onChange={handleFileChange} />
                  <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="w-16 h-16 bg-zinc-900 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                      <UploadCloud className="w-8 h-8 text-zinc-400" />
                    </div>
                    <h3 className="text-xl font-semibold mb-2">Upload Media</h3>
                    <p className="text-zinc-500 text-sm mb-4">Drag &amp; drop or click to browse</p>
                    <div className="flex items-center gap-4 text-xs text-zinc-600">
                      <span className="flex items-center gap-1"><ImageIcon className="w-3 h-3" /> Photos up to {MAX_FILE_MB} MB</span>
                      <span className="flex items-center gap-1"><Video className="w-3 h-3" /> Videos up to {MAX_FILE_MB} MB</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="relative w-full h-full flex flex-col items-center justify-center gap-3">
                <div className="absolute top-0 right-0 z-10 flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={resetAll}
                    className="bg-black/50 backdrop-blur border-white/10 hover:bg-white/10">
                    <RefreshCw className="w-4 h-4 mr-2" />New Upload
                  </Button>
                  {isCompleted && currentJob?.processedUrl && (
                    <a href={currentJob.processedUrl} download={`enhanced-${file?.name ?? "image.jpg"}`}>
                      <Button size="sm" className="bg-white text-black hover:bg-white/90 shadow-lg">
                        <Download className="w-4 h-4 mr-2" />Export
                      </Button>
                    </a>
                  )}
                </div>

                <div className="relative max-w-full rounded-lg overflow-hidden border border-white/10 shadow-2xl bg-black flex items-center justify-center">
                  {isProcessing && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center z-20 rounded-lg">
                      <Loader2 className="w-10 h-10 text-teal-500 animate-spin mb-4" />
                      <p className="text-lg font-medium">{processStage === "uploading" ? "Uploading..." : "Applying AI Magic..."}</p>
                      <p className="text-sm text-zinc-400 mt-1">This may take a few moments</p>
                    </div>
                  )}
                  {isCompleted && currentJob?.processedUrl ? (
                    mediaType === "video"
                      ? <video src={currentJob.processedUrl} controls autoPlay loop muted className="max-w-full max-h-[80vh] object-contain" />
                      : <img src={currentJob.processedUrl} alt="Enhanced" className="max-w-full max-h-[80vh] object-contain" />
                  ) : (
                    mediaType === "video"
                      ? <video src={previewUrl} controls className="max-w-full max-h-[80vh] object-contain" />
                      : <img src={previewUrl} alt="Original"
                          className="max-w-full max-h-[80vh] object-contain"
                          style={isProcessing ? { opacity: 0.5 } : previewStyle} />
                  )}
                </div>

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
                  {isCompleted && <><span>&#8226;</span><span className="text-teal-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Enhanced</span></>}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </Layout>
  );
}
