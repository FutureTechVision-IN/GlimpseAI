import React from "react";
import { motion } from "framer-motion";
import { Loader2, CheckCircle2, AlertCircle, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * <ProgressTimeline /> — visual step indicator for chained enhancement runs.
 *
 * Replaces the previous single-line "step 2/3 — enhancing" status text with
 * a discrete dot-line timeline that makes it obvious:
 *  - which steps the user opted in to (filter / upscale are conditional)
 *  - which step is currently running (animated spinner)
 *  - which steps have already completed (filled check)
 *  - which step failed (red) — so users know exactly where to retry
 *
 * Stage status:
 *  - "pending"  — not yet reached
 *  - "active"   — currently processing
 *  - "done"     — completed successfully
 *  - "failed"   — completed unsuccessfully
 */
export type StageStatus = "pending" | "active" | "done" | "failed";

export interface TimelineStage {
  key: string;
  label: string;
  detail?: string;       // small caption under label, e.g. "Cinematic"
  status: StageStatus;
}

interface ProgressTimelineProps {
  stages: TimelineStage[];
  /** Optional dense mode for tight side panels. */
  compact?: boolean;
  className?: string;
}

export function ProgressTimeline({ stages, compact = false, className }: ProgressTimelineProps): React.ReactElement {
  return (
    <div
      className={cn(
        "flex items-stretch w-full rounded-lg border border-zinc-800 bg-zinc-950/70 px-2 py-2",
        compact ? "gap-1" : "gap-2",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {stages.map((s, idx) => {
        const isLast = idx === stages.length - 1;
        return (
          <React.Fragment key={s.key}>
            <StageDot stage={s} compact={compact} />
            {!isLast && <Connector status={stages[idx]?.status ?? "pending"} compact={compact} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function StageDot({ stage, compact }: { stage: TimelineStage; compact: boolean }) {
  const { status, label, detail } = stage;
  return (
    <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
      <motion.div
        layout
        initial={false}
        animate={{
          scale: status === "active" ? [1, 1.06, 1] : 1,
        }}
        transition={{
          duration: 1.4,
          repeat: status === "active" ? Infinity : 0,
          ease: "easeInOut",
        }}
        className={cn(
          "flex items-center justify-center rounded-full border transition-colors",
          compact ? "h-5 w-5" : "h-6 w-6",
          status === "done" && "border-emerald-500/60 bg-emerald-500/15 text-emerald-300",
          status === "active" && "border-teal-400/80 bg-teal-500/20 text-teal-200 shadow-md shadow-teal-500/20",
          status === "failed" && "border-red-500/70 bg-red-500/15 text-red-300",
          status === "pending" && "border-zinc-700 bg-zinc-900/60 text-zinc-600",
        )}
        aria-current={status === "active" ? "step" : undefined}
        aria-label={`${label}: ${status}`}
      >
        {status === "done" && <CheckCircle2 className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />}
        {status === "active" && <Loader2 className={cn(compact ? "h-3 w-3" : "h-3.5 w-3.5", "animate-spin")} />}
        {status === "failed" && <AlertCircle className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />}
        {status === "pending" && <Circle className={compact ? "h-2 w-2" : "h-2.5 w-2.5"} />}
      </motion.div>
      <div className="text-center min-w-0 w-full">
        <div
          className={cn(
            "truncate leading-none font-medium",
            compact ? "text-[9px]" : "text-[10px]",
            status === "done" && "text-emerald-200",
            status === "active" && "text-teal-100",
            status === "failed" && "text-red-200",
            status === "pending" && "text-zinc-500",
          )}
        >
          {label}
        </div>
        {detail && (
          <div className={cn("truncate text-zinc-500 leading-none mt-0.5", compact ? "text-[8px]" : "text-[9px]")}>
            {detail}
          </div>
        )}
      </div>
    </div>
  );
}

function Connector({ status, compact }: { status: StageStatus; compact: boolean }) {
  return (
    <div
      className={cn(
        "self-start mt-2.5 flex-1 rounded-full overflow-hidden bg-zinc-800",
        compact ? "h-0.5 max-w-[16px]" : "h-0.5 max-w-[28px]",
      )}
    >
      <motion.div
        initial={{ width: status === "done" ? "100%" : "0%" }}
        animate={{ width: status === "done" ? "100%" : status === "active" ? "55%" : "0%" }}
        transition={{ duration: 0.4 }}
        className={cn(
          "h-full",
          status === "done" && "bg-emerald-500",
          status === "active" && "bg-teal-400",
          status === "failed" && "bg-red-500",
          status === "pending" && "bg-zinc-700",
        )}
      />
    </div>
  );
}
