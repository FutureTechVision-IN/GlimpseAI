import React, { useState } from "react";
import Layout from "../components/layout";
import { useGetUserHistory } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Image as ImageIcon, Video, Download, ExternalLink, Pin, PinOff, ChevronDown, ChevronUp, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const HISTORY_LIMIT = 10;
const PINNED_KEY = "glimpse_pinned_jobs";

function getPinned(): number[] {
  try { return JSON.parse(localStorage.getItem(PINNED_KEY) ?? "[]"); } catch { return []; }
}
function setPinned(ids: number[]) {
  localStorage.setItem(PINNED_KEY, JSON.stringify(ids));
}

function ThumbImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}

export default function History() {
  const { data: history, isLoading } = useGetUserHistory({ limit: 100 });
  const [pinnedIds, setPinnedIds] = useState<number[]>(getPinned);
  const [showAll, setShowAll] = useState(false);

  const allItems = history?.items ?? [];
  const pinned = allItems.filter(j => pinnedIds.includes(j.id));
  const recent = allItems.filter(j => !pinnedIds.includes(j.id));
  const displayRecent = showAll ? recent : recent.slice(0, HISTORY_LIMIT);
  const displayItems = [...pinned, ...displayRecent];
  const hiddenCount = recent.length - displayRecent.length;

  const togglePin = (id: number) => {
    const next = pinnedIds.includes(id)
      ? pinnedIds.filter(x => x !== id)
      : [id, ...pinnedIds];
    setPinnedIds(next);
    setPinned(next);
  };

  return (
    <Layout>
      <div className="p-8 max-w-7xl mx-auto w-full">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">History</h1>
            <p className="text-zinc-400 mt-1">Your past creative enhancements.</p>
          </div>
          {allItems.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-zinc-500 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
              <Info className="w-3.5 h-3.5 shrink-0" />
              Showing recent {HISTORY_LIMIT}. Pin items to keep them visible.
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array(8).fill(0).map((_, i) => (
              <div key={i} className="aspect-square bg-zinc-900 animate-pulse rounded-xl" />
            ))}
          </div>
        ) : allItems.length === 0 ? (
          <div className="text-center py-20 bg-zinc-950/50 rounded-2xl border border-zinc-800 border-dashed">
            <ImageIcon className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
            <h3 className="text-xl font-medium mb-2">No history yet</h3>
            <p className="text-zinc-500">Your enhanced photos and videos will appear here.</p>
          </div>
        ) : (
          <>
            {/* Pinned section header */}
            {pinned.length > 0 && (
              <div className="flex items-center gap-2 mb-3 text-xs text-amber-400 font-medium">
                <Pin className="w-3 h-3" />
                Pinned ({pinned.length})
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {displayItems.map(job => {
                const isPinned = pinnedIds.includes(job.id);
                const imgSrc = job.thumbnailUrl ?? (job.mediaType !== "video" ? job.processedUrl : null);

                return (
                  <Card
                    key={job.id}
                    className={cn(
                      "group overflow-hidden border-zinc-800 bg-zinc-950 hover:border-zinc-700 transition-all",
                      isPinned && "ring-1 ring-amber-500/30 border-amber-500/20"
                    )}
                  >
                    <div className="aspect-square relative bg-zinc-900 flex items-center justify-center overflow-hidden">
                      {/* Thumbnail */}
                      {imgSrc ? (
                        <ThumbImage src={imgSrc} alt={job.filename} className="w-full h-full object-cover" />
                      ) : job.processedUrl && job.mediaType === "video" ? (
                        <video src={job.processedUrl} className="w-full h-full object-cover" muted playsInline />
                      ) : (
                        <div className="text-zinc-700">
                          {job.mediaType === "video" ? <Video className="w-8 h-8" /> : <ImageIcon className="w-8 h-8" />}
                        </div>
                      )}

                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        {job.processedUrl && (
                          <>
                            <a href={job.processedUrl} target="_blank" rel="noreferrer">
                              <Button size="icon" variant="secondary" className="w-8 h-8 rounded-full bg-white/20 hover:bg-white text-white hover:text-black backdrop-blur">
                                <ExternalLink className="w-4 h-4" />
                              </Button>
                            </a>
                            <a href={job.processedUrl} download>
                              <Button size="icon" variant="secondary" className="w-8 h-8 rounded-full bg-white/20 hover:bg-white text-white hover:text-black backdrop-blur">
                                <Download className="w-4 h-4" />
                              </Button>
                            </a>
                          </>
                        )}
                        <Button
                          size="icon"
                          variant="secondary"
                          title={isPinned ? "Unpin" : "Pin to keep"}
                          onClick={() => togglePin(job.id)}
                          className={cn(
                            "w-8 h-8 rounded-full backdrop-blur transition-colors",
                            isPinned
                              ? "bg-amber-400/20 hover:bg-amber-400/40 text-amber-300"
                              : "bg-white/20 hover:bg-white/40 text-white"
                          )}
                        >
                          {isPinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                        </Button>
                      </div>

                      {/* Status badges */}
                      <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/60 backdrop-blur text-[10px] font-medium uppercase tracking-wider text-zinc-300">
                        {job.mediaType}
                      </div>
                      <div className={cn(
                        "absolute top-2 right-2 px-2 py-0.5 rounded bg-black/60 backdrop-blur text-[10px] font-medium uppercase tracking-wider",
                        job.status === "completed" ? "text-emerald-400" : job.status === "failed" ? "text-rose-400" : "text-blue-400"
                      )}>
                        {job.status}
                      </div>
                      {isPinned && (
                        <div className="absolute bottom-2 right-2">
                          <Pin className="w-3 h-3 text-amber-400" />
                        </div>
                      )}
                    </div>

                    <div className="p-3">
                      <div className="truncate text-sm font-medium" title={job.filename}>{job.filename}</div>
                      <div className="flex items-center justify-between mt-1">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-zinc-700 text-zinc-500 capitalize">
                          {job.enhancementType ?? "manual"}
                        </Badge>
                        <span className="text-xs text-zinc-600">{new Date(job.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>

            {/* Show more / less */}
            {(hiddenCount > 0 || showAll) && (
              <div className="mt-6 text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-zinc-400 hover:text-white gap-2"
                  onClick={() => setShowAll(v => !v)}
                >
                  {showAll ? (
                    <><ChevronUp className="w-4 h-4" /> Show less</>
                  ) : (
                    <><ChevronDown className="w-4 h-4" /> Show {hiddenCount} more</>
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
