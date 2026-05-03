import React, { useMemo, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../lib/auth-context";
import { useGetUserUsage, useListMediaJobs } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import Layout from "../components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowUpCircle, Sparkles, Wand2, Film, Clock, ArrowRight, Zap,
  CheckCircle2, XCircle, Loader2, Crown, Upload, Star, Layers,
  Image as ImageIcon, Video as VideoIcon, TrendingUp,
} from "lucide-react";
import {
  getEnhancementMeta,
  groupEnhancementsForDashboardByCategory,
  enhancementStudioHref,
} from "@/lib/enhancement-labels";
import { cn } from "@/lib/utils";
import AiChatWidget from "../components/ai-chat-widget";

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

type ActionKey = "upscale" | "enhance" | "restore" | "video" | "batch";

interface ActionDef {
  key: ActionKey;
  icon: React.ElementType;
  title: string;
  tagline: string;
  href: string;
  accept: string;
  accent: string;      // tailwind border/shadow color tokens
  iconBg: string;
  iconFg: string;
  badge?: string;      // e.g. "★ Most used"
  /** When true, the file input accepts multiple files at once (Batch). */
  multiple?: boolean;
}

const ACTIONS: ActionDef[] = [
  {
    key: "upscale",
    icon: ArrowUpCircle,
    title: "Upscale",
    tagline: "Up to 4× sharper — in one click",
    href: "/photo-studio?enhance=upscale",
    accept: "image/*",
    accent: "border-teal-500/60 hover:border-teal-400 shadow-teal-500/20 hover:shadow-teal-500/40",
    iconBg: "bg-teal-500/15",
    iconFg: "text-teal-400",
    badge: "★ Most used",
  },
  {
    key: "enhance",
    icon: Wand2,
    title: "Enhance",
    tagline: "Auto Face AI — balanced faces & detail",
    href: "/photo-studio?enhance=auto_face",
    accept: "image/*",
    accent: "border-zinc-800/70 hover:border-cyan-500/40 shadow-transparent hover:shadow-cyan-500/20",
    iconBg: "bg-cyan-500/15",
    iconFg: "text-cyan-400",
  },
  {
    key: "restore",
    icon: Sparkles,
    title: "Restore",
    tagline: "Fix old, damaged photos",
    href: "/photo-studio?enhance=codeformer",
    accept: "image/*",
    accent: "border-zinc-800/70 hover:border-emerald-500/40 shadow-transparent hover:shadow-emerald-500/20",
    iconBg: "bg-emerald-500/15",
    iconFg: "text-emerald-400",
  },
  {
    key: "video",
    icon: Film,
    title: "Video",
    tagline: "Trim, stabilize & AI video restore",
    href: "/video-studio",
    accept: "video/*",
    accent: "border-zinc-800/70 hover:border-purple-500/40 shadow-transparent hover:shadow-purple-500/20",
    iconBg: "bg-purple-500/15",
    iconFg: "text-purple-400",
  },
  {
    key: "batch",
    icon: Layers,
    title: "Batch",
    tagline: "Enhance many photos or videos at once",
    href: "/photo-studio?mode=batch",
    accept: "image/*,video/*",
    accent: "border-zinc-800/70 hover:border-amber-500/40 shadow-transparent hover:shadow-amber-500/20",
    iconBg: "bg-amber-500/15",
    iconFg: "text-amber-400",
    badge: "New",
    multiple: true,
  },
];

// ── Hero action card (drag-drop aware) ─────────────────────────────────────
function ActionCard({ action }: { action: ActionDef }) {
  const [, navigate] = useLocation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const routeWithFile = useCallback(
    (f: File | null) => {
      // Stash file in sessionStorage so Photo/Video Studio can pick it up.
      if (f) {
        try {
          const reader = new FileReader();
          reader.onload = () => {
            sessionStorage.setItem(
              "glimpse:pending-upload",
              JSON.stringify({ name: f.name, type: f.type, dataUrl: reader.result }),
            );
            navigate(action.href);
          };
          reader.readAsDataURL(f);
        } catch {
          navigate(action.href);
        }
      } else {
        navigate(action.href);
      }
    },
    [action.href, navigate],
  );

  /**
   * Multi-file router used by the Batch action card. Reads each file as a
   * data URL, stashes them as glimpse:pending-batch, and routes to the
   * studio in batch mode. Limited to a sane maximum (12) to avoid stalling
   * sessionStorage; the editor surfaces the user's plan limit on top of this.
   */
  const routeWithFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) {
        navigate(action.href);
        return;
      }
      const MAX_BATCH = 12;
      const trimmed = files.slice(0, MAX_BATCH);
      const readAll = trimmed.map(
        (f) =>
          new Promise<{ name: string; type: string; dataUrl: string }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({ name: f.name, type: f.type, dataUrl: String(reader.result ?? "") });
            reader.onerror = () => reject(new Error("Read failed"));
            reader.readAsDataURL(f);
          }),
      );
      Promise.all(readAll)
        .then((items) => {
          try {
            sessionStorage.setItem("glimpse:pending-batch", JSON.stringify(items));
          } catch {
            // Quota exceeded — drop to single-file route silently.
            sessionStorage.setItem(
              "glimpse:pending-upload",
              JSON.stringify(items[0]),
            );
          }
          navigate(action.href);
        })
        .catch(() => navigate(action.href));
    },
    [action.href, navigate],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const list = Array.from(e.dataTransfer.files ?? []);
    if (list.length === 0) return;
    if (action.multiple) routeWithFiles(list);
    else routeWithFile(list[0] ?? null);
  };

  const Icon = action.icon;

  return (
    <motion.div
      layout
      whileHover={{ y: -2 }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={onDrop}
      className={cn(
        "group relative rounded-2xl border bg-gradient-to-br from-zinc-900/90 to-zinc-950 p-5 shadow-lg transition-all",
        action.accent,
        isDragOver && "ring-2 ring-teal-400/70 border-teal-400",
      )}
    >
      {action.badge && (
        <span className="absolute -top-2 right-4 inline-flex items-center gap-1 rounded-full bg-teal-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-950 shadow-md shadow-teal-500/30">
          <Star className="h-3 w-3 fill-zinc-950" />
          {action.badge.replace("★ ", "")}
        </span>
      )}

      <div className={cn("mb-4 flex h-10 w-10 items-center justify-center rounded-xl", action.iconBg)}>
        <Icon className={cn("h-5 w-5", action.iconFg)} aria-hidden />
      </div>

      <h3 className="text-lg font-semibold text-white">{action.title}</h3>
      <p className="mt-1 text-xs text-zinc-400">{action.tagline}</p>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={cn(
          "mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
          action.key === "upscale"
            ? "bg-gradient-to-r from-teal-500 to-cyan-500 text-zinc-950 hover:from-teal-400 hover:to-cyan-400 focus-visible:ring-teal-300"
            : "bg-zinc-800 text-zinc-100 hover:bg-zinc-700 focus-visible:ring-zinc-400",
        )}
        aria-label={`Upload ${action.multiple ? "multiple files" : (action.accept.includes("video") ? "video" : "image")} for ${action.title}`}
      >
        <Upload className="h-3.5 w-3.5" />
        Upload {action.multiple ? "multiple files" : (action.accept.includes("video") ? "video" : "image")}
      </button>

      <div
        className={cn(
          "mt-3 rounded-lg border border-dashed py-2 text-center text-[11px] transition-colors",
          isDragOver ? "border-teal-400 text-teal-300" : "border-zinc-800 text-zinc-500 group-hover:border-zinc-700",
        )}
      >
        or drop a file here
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={action.accept}
        multiple={action.multiple ?? false}
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (action.multiple) {
            routeWithFiles(files);
          } else {
            routeWithFile(files[0] ?? null);
          }
        }}
      />

      <Link
        href={action.href}
        className="absolute inset-0 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
        aria-label={`Open ${action.title}`}
        onClick={(e) => {
          // Let the actual buttons/inputs above handle their own clicks.
          const t = e.target as HTMLElement;
          if (t.closest("button") || t.closest("input") || t.closest("[data-stop-link]")) {
            e.preventDefault();
          }
        }}
      />
    </motion.div>
  );
}

// ── Status icon helper ────────────────────────────────────────────────────
function statusIcon(status: string) {
  switch (status) {
    case "completed": return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
    case "failed":    return <XCircle className="h-3.5 w-3.5 text-red-400" />;
    case "processing":return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />;
    default:          return <Clock className="h-3.5 w-3.5 text-zinc-500" />;
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth();
  const { data: usage, isLoading: isLoadingUsage } = useGetUserUsage();
  const { data: recentJobs, isLoading: isLoadingJobs } = useListMediaJobs({ status: "all" });

  const enhancementSections = useMemo(() => groupEnhancementsForDashboardByCategory(), []);

  const creditsUsed  = usage?.creditsUsed  || 0;
  const creditsLimit = usage?.creditsLimit || 1;
  const creditsRemaining = Math.max(creditsLimit - creditsUsed, 0);
  const creditsPercent = Math.min((creditsUsed / creditsLimit) * 100, 100);
  const isFreeUser = !user?.planId;

  const recentDone = useMemo(
    () =>
      (recentJobs || [])
        .filter((j) => j.status === "completed" || j.status === "processing")
        .slice(0, 6),
    [recentJobs],
  );

  const totals = useMemo(() => {
    const jobs = recentJobs || [];
    const completed = jobs.filter((j) => j.status === "completed").length;
    const success = jobs.length ? Math.round((completed / jobs.length) * 100) : 0;
    return { completed, total: jobs.length, success };
  }, [recentJobs]);

  return (
    <Layout>
      <div className="relative mx-auto w-full max-w-7xl space-y-10 overflow-hidden p-6 lg:p-8">
        {/* Ambient glow */}
        <div className="pointer-events-none absolute -right-40 -top-40 h-[500px] w-[500px] rounded-full bg-teal-500/5 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-40 -left-40 h-[400px] w-[400px] rounded-full bg-purple-500/5 blur-[100px]" />

        {/* ── Header: greeting + credits pill ───────────────────────────── */}
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="relative flex flex-col justify-between gap-4 lg:flex-row lg:items-end"
        >
          <div>
            <h1 className="bg-gradient-to-r from-white via-zinc-100 to-zinc-400 bg-clip-text text-3xl font-bold tracking-tight text-transparent lg:text-4xl">
              {getGreeting()}, {user?.name?.split(" ")[0] || "Creator"}
            </h1>
            <p className="mt-1.5 text-sm text-zinc-400">
              What would you like to create today?
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/billing"
              className="group inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-teal-500/40 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
              aria-label={`${creditsRemaining} credits remaining. View billing.`}
            >
              <Zap className="h-3.5 w-3.5 text-teal-400" />
              <span className="font-mono">
                {isLoadingUsage ? "—" : creditsRemaining.toLocaleString()}
              </span>
              <span className="text-zinc-500">credits</span>
              <span className="h-1 w-12 overflow-hidden rounded-full bg-zinc-800">
                <span
                  className={cn(
                    "block h-full rounded-full transition-all",
                    creditsPercent > 80 ? "bg-amber-400" : "bg-teal-400",
                  )}
                  style={{ width: `${creditsPercent}%` }}
                />
              </span>
            </Link>
            {isFreeUser && (
              <Link href="/pricing">
                <Button
                  size="sm"
                  className="h-8 gap-1 bg-gradient-to-r from-teal-500 to-cyan-500 text-xs font-semibold text-zinc-950 hover:from-teal-400 hover:to-cyan-400"
                >
                  <Crown className="h-3.5 w-3.5" />
                  Upgrade
                </Button>
              </Link>
            )}
          </div>
        </motion.header>

        {/* ── Hero action cards ─────────────────────────────────────────── */}
        <section aria-labelledby="primary-actions">
          <h2 id="primary-actions" className="sr-only">
            Primary actions
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ACTIONS.map((a) => (
              <ActionCard key={a.key} action={a} />
            ))}
          </div>
        </section>

        {/* ── Full enhancement library (deep-links into Photo / Video Studio) ─ */}
        <section aria-labelledby="enhancement-library" className="space-y-6">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="enhancement-library" className="text-lg font-semibold text-white">
                Browse every enhancement
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Jump straight into Photo Studio or Video Studio with the mode pre-selected.
              </p>
            </div>
            <Link
              href="/photo-studio"
              className="text-xs text-teal-400 hover:text-teal-300 focus:outline-none focus-visible:underline"
            >
              Open Photo Studio
            </Link>
          </div>
          <div className="space-y-6">
            {enhancementSections.map(({ category, sectionTitle, items }) => (
              <div key={category}>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  {sectionTitle}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {items.map(({ id, meta }) => (
                    <Link
                      key={id}
                      href={enhancementStudioHref(id, meta.category)}
                      className={cn(
                        "inline-flex max-w-full items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:border-teal-500/50 hover:bg-teal-500/10 hover:text-teal-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400",
                        meta.borderColor,
                        meta.bgColor,
                        meta.color,
                      )}
                    >
                      <span className="truncate">{meta.label}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Continue where you left off ───────────────────────────────── */}
        <section aria-labelledby="continue" className="space-y-3">
          <div className="flex items-end justify-between">
            <h2 id="continue" className="text-lg font-semibold text-white">
              Continue where you left off
            </h2>
            <Link
              href="/history"
              className="inline-flex items-center gap-1 text-xs text-teal-400 hover:text-teal-300 focus:outline-none focus-visible:underline"
            >
              See all
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {isLoadingJobs ? (
            <div className="flex gap-3 overflow-x-auto">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-32 w-44 flex-shrink-0 animate-pulse rounded-xl bg-zinc-800/60" />
              ))}
            </div>
          ) : recentDone.length === 0 ? (
            <Card className="border-dashed border-zinc-800 bg-zinc-950/60">
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-500/10">
                  <Sparkles className="h-5 w-5 text-teal-400" />
                </div>
                <p className="text-sm text-zinc-300">No projects yet</p>
                <p className="text-xs text-zinc-500">
                  Drop an image into a card above to get started in seconds.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
              {recentDone.map((job) => {
                const meta = getEnhancementMeta(job.enhancementType);
                const thumb = (job as any).processedUrl || (job as any).thumbnailUrl || (job as any).sourceUrl;
                // Parse chain metadata stored in errorMessage by /media/enhance-chain.
                let chainStages: Array<{ stage: string; op: string }> = [];
                try {
                  const raw = (job as { errorMessage?: string | null }).errorMessage;
                  if (raw && typeof raw === "string" && raw.startsWith("{")) {
                    const parsed = JSON.parse(raw) as { chain?: Array<{ stage: string; op: string }> };
                    chainStages = Array.isArray(parsed.chain) ? parsed.chain : [];
                  }
                } catch { /* not chain metadata, ignore */ }
                const filterStage = chainStages.find((s) => s.stage === "filter");
                const upscaleStage = chainStages.find((s) => s.stage === "upscale");
                return (
                  <Link key={job.id} href="/history">
                    <a className="group relative block h-32 w-44 flex-shrink-0 snap-start overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 transition-colors hover:border-teal-500/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={job.filename || "Project thumbnail"}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-zinc-600">
                          {job.mediaType === "video" ? (
                            <VideoIcon className="h-6 w-6" />
                          ) : (
                            <ImageIcon className="h-6 w-6" />
                          )}
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-2">
                        <div className="flex items-center justify-between gap-1 flex-wrap">
                          <span className={cn("truncate rounded px-1 py-0.5 text-[9px] font-semibold", meta.bgColor, meta.color, "border", meta.borderColor)}>
                            {meta.shortLabel}
                          </span>
                          {filterStage && (
                            <span className="rounded border border-violet-500/40 bg-violet-500/10 px-1 py-0.5 text-[9px] font-semibold text-violet-300">
                              + {filterStage.op}
                            </span>
                          )}
                          {upscaleStage && (
                            <span className="rounded border border-cyan-500/40 bg-cyan-500/10 px-1 py-0.5 text-[9px] font-semibold text-cyan-300">
                              + {upscaleStage.op === "upscale_4x" || upscaleStage.op === "esrgan_upscale_4x" ? "4×" : "2×"}
                            </span>
                          )}
                          {statusIcon(job.status)}
                        </div>
                        <div className="mt-1 truncate text-[10px] text-zinc-300">
                          {new Date(job.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </a>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Try something new ─────────────────────────────────────────── */}
        <section aria-labelledby="discover" className="space-y-3">
          <h2 id="discover" className="text-lg font-semibold text-white">
            Try something new
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Link href="/photo-studio?enhance=upscale_4x">
              <Card className="cursor-pointer border-zinc-800 bg-gradient-to-br from-teal-950/40 to-zinc-950 transition-all hover:border-teal-500/40 hover:shadow-lg hover:shadow-teal-500/20">
                <CardContent className="flex items-start gap-4 p-5">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-teal-500/20">
                    <Layers className="h-5 w-5 text-teal-300" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-white">4× Upscale (Pro)</div>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      Take small images to print-ready resolution with face-aware detail preservation.
                    </p>
                    <span className="mt-2 inline-flex items-center gap-1 text-xs text-teal-400">
                      Learn more <ArrowRight className="h-3 w-3" />
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>

            <Link href="/photo-studio?enhance=codeformer">
              <Card className="cursor-pointer border-zinc-800 bg-gradient-to-br from-emerald-950/40 to-zinc-950 transition-all hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/20">
                <CardContent className="flex items-start gap-4 p-5">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-500/20">
                    <Sparkles className="h-5 w-5 text-emerald-300" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-white">3-Phase Photo Restoration</div>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      Repair damage, restore faces, and upscale — all in one guided workflow.
                    </p>
                    <span className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-400">
                      Learn more <ArrowRight className="h-3 w-3" />
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>
        </section>

        {/* ── At-a-glance stats (condensed, not dominant) ───────────────── */}
        {totals.total > 0 && (
          <section aria-labelledby="glance" className="space-y-3">
            <h2 id="glance" className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
              <TrendingUp className="h-4 w-4 text-zinc-500" />
              At a glance
            </h2>
            <div className="grid grid-cols-3 gap-3">
              <Card className="border-zinc-800 bg-zinc-950/60">
                <CardContent className="p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Projects</div>
                  <div className="mt-1 text-xl font-bold text-white">{totals.total}</div>
                </CardContent>
              </Card>
              <Card className="border-zinc-800 bg-zinc-950/60">
                <CardContent className="p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Completed</div>
                  <div className="mt-1 text-xl font-bold text-white">{totals.completed}</div>
                </CardContent>
              </Card>
              <Card className="border-zinc-800 bg-zinc-950/60">
                <CardContent className="p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Success</div>
                  <div className="mt-1 text-xl font-bold text-white">{totals.success}%</div>
                </CardContent>
              </Card>
            </div>
          </section>
        )}
      </div>
      <AiChatWidget context="dashboard" />
    </Layout>
  );
}
