import React, { useState, useEffect, useCallback } from "react";
import Layout from "../components/layout";
import { Card } from "@/components/ui/card";
import { Image as ImageIcon, Download, Trash2, Trash, HardDrive, Info, AlertTriangle, Clock, ArrowLeftRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  getHistory,
  deleteHistoryItem,
  clearHistory,
  LocalHistoryItem,
} from "@/lib/local-history";
import { getEnhancementMeta, formatProcessingTime } from "@/lib/enhancement-labels";
import { buildEnhancedDownloadName } from "@/lib/export-filename";
import { Link } from "wouter";

function CompareDialog({ item, onClose }: { item: LocalHistoryItem; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-4xl mx-4 bg-zinc-950 border border-zinc-800 rounded-2xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>
        <h3 className="text-lg font-semibold mb-1">Side-by-Side Comparison</h3>
        <p className="text-sm text-zinc-500 mb-4">{item.filename}</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Original</span>
            <div className="aspect-square rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 flex items-center justify-center">
              {item.originalThumbnailUri ? (
                <img src={item.originalThumbnailUri} alt="Original" className="w-full h-full object-contain" />
              ) : (
                <div className="text-center text-zinc-600 p-4">
                  <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-xs">Original not available</p>
                </div>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Enhanced</span>
            <div className="aspect-square rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 flex items-center justify-center">
              <img src={item.thumbnailUri} alt="Enhanced" className="w-full h-full object-contain" />
            </div>
          </div>
        </div>
        {item.processingTimeMs && (
          <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
            <Clock className="w-3 h-3" />
            Processed in {formatProcessingTime(item.processingTimeMs)}
          </div>
        )}
      </div>
    </div>
  );
}

export default function History() {
  const [items, setItems] = useState<LocalHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [compareItem, setCompareItem] = useState<LocalHistoryItem | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getHistory();
      setItems(data);
    } catch {
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: number) => {
    await deleteHistoryItem(id);
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const handleClearAll = async () => {
    await clearHistory();
    setItems([]);
  };

  const handleDownload = (item: LocalHistoryItem) => {
    try {
      const byteString = atob(item.dataUri.split(",")[1] ?? item.dataUri);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
      const blob = new Blob([ab], { type: item.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = buildEnhancedDownloadName({
        originalFilename: item.filename,
        enhancementType: item.enhancementType,
        referenceCode: item.referenceCode,
        mime: item.mimeType,
      });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // fallback: open in new tab
      const w = window.open();
      if (w) { w.document.write(`<img src="${item.dataUri}" />`); }
    }
  };

  return (
    <Layout>
      <div className="p-8 max-w-7xl mx-auto w-full">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">History</h1>
            <p className="text-zinc-400 mt-1">Your 5 most recent photo enhancements, stored locally.</p>
          </div>
          {items.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-zinc-500 hover:text-rose-400 gap-2"
              onClick={handleClearAll}
            >
              <Trash className="w-3.5 h-3.5" /> Clear All
            </Button>
          )}
        </div>

        {/* Info banner */}
        <div className="flex items-start gap-3 mb-6 px-4 py-3 rounded-xl bg-zinc-900/80 border border-zinc-800 text-sm text-zinc-400">
          <HardDrive className="w-4 h-4 shrink-0 mt-0.5 text-zinc-500" />
          <div>
            <p>Images are stored <strong className="text-zinc-300">locally in your browser</strong> using IndexedDB. Only the 5 most recent photo enhancements are kept. Videos are not stored (too large).</p>
            <p className="mt-1 text-xs text-zinc-600">Clearing browser data will erase your history. History does not sync across devices.</p>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {Array(5).fill(0).map((_, i) => (
              <div key={i} className="aspect-square bg-zinc-900 animate-pulse rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20 bg-zinc-950/50 rounded-2xl border border-zinc-800 border-dashed">
            <ImageIcon className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
            <h3 className="text-xl font-medium mb-2">No history yet</h3>
            <p className="text-zinc-500 mb-4">Enhanced photos will appear here automatically.</p>
            <Link href="/photo-studio">
              <Button size="sm" className="bg-gradient-to-r from-teal-600 to-cyan-600 text-white">
                Open Photo Studio
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {items.map(item => {
              const meta = getEnhancementMeta(item.enhancementType);
              return (
              <Card
                key={item.id}
                className="group overflow-hidden border-zinc-800 bg-zinc-950 hover:border-zinc-700 transition-all"
              >
                <div className="aspect-square relative bg-zinc-900 flex items-center justify-center overflow-hidden">
                  <img
                    src={item.thumbnailUri}
                    alt={item.filename}
                    className="w-full h-full object-cover"
                  />

                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <Button
                      size="icon"
                      variant="secondary"
                      title="Compare"
                      onClick={() => setCompareItem(item)}
                      className="w-8 h-8 rounded-full bg-white/20 hover:bg-teal-500 text-white backdrop-blur"
                    >
                      <ArrowLeftRight className="w-4 h-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="secondary"
                      title="Download"
                      onClick={() => handleDownload(item)}
                      className="w-8 h-8 rounded-full bg-white/20 hover:bg-white text-white hover:text-black backdrop-blur"
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="secondary"
                      title="Remove from history"
                      onClick={() => item.id && handleDelete(item.id)}
                      className="w-8 h-8 rounded-full bg-white/20 hover:bg-rose-500 text-white backdrop-blur"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* Enhancement type badge */}
                  <div className={cn(
                    "absolute top-2 left-2 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border backdrop-blur",
                    meta.bgColor, meta.color, meta.borderColor
                  )}>
                    {meta.shortLabel}
                  </div>

                  {/* Category indicator */}
                  {meta.category === "restoration" && (
                    <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30 text-[9px] font-bold text-emerald-400 uppercase">
                      AI
                    </div>
                  )}
                </div>

                <div className="p-3">
                  <div className="truncate text-sm font-medium" title={item.filename}>{item.filename}</div>
                  <div className="flex items-center justify-between mt-1.5">
                    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 border", meta.borderColor, meta.color)}>
                      {meta.label}
                    </Badge>
                    <span className="text-[10px] text-zinc-600">{new Date(item.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <span className={cn(
                      "text-[9px] font-semibold uppercase px-1 py-0.5 rounded border",
                      meta.category === "restoration" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
                      : meta.category === "video" ? "text-purple-400 bg-purple-500/10 border-purple-500/30"
                      : meta.category === "filter" ? "text-violet-400 bg-violet-500/10 border-violet-500/30"
                      : "text-teal-400 bg-teal-500/10 border-teal-500/30"
                    )}>
                      {meta.category}
                    </span>
                    {/* Chain badges: filter and upscale stages stacked on
                        top of the primary enhancement on a single row. */}
                    {item.filterId && (
                      <span className="text-[9px] font-semibold uppercase px-1 py-0.5 rounded border text-violet-300 bg-violet-500/10 border-violet-500/30">
                        + {item.filterId}
                      </span>
                    )}
                    {item.upscale && (
                      <span className="text-[9px] font-semibold uppercase px-1 py-0.5 rounded border text-cyan-300 bg-cyan-500/10 border-cyan-500/30">
                        + {item.upscale === "upscale_4x" || item.upscale === "esrgan_upscale_4x" ? "4×" : "2×"}
                      </span>
                    )}
                    {item.servedBy === "sidecar" && (
                      <span className="text-[9px] font-semibold uppercase px-1 py-0.5 rounded border text-emerald-300 bg-emerald-500/10 border-emerald-500/30">
                        Premium
                      </span>
                    )}
                    <span className="text-[9px] text-zinc-600">{new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  {item.processingTimeMs && (
                    <div className="flex items-center gap-1 mt-1.5 text-[10px] text-zinc-500">
                      <Clock className="w-2.5 h-2.5" />
                      {formatProcessingTime(item.processingTimeMs)}
                    </div>
                  )}
                </div>
              </Card>
              );
            })}
          </div>
        )}
      </div>
      {compareItem && <CompareDialog item={compareItem} onClose={() => setCompareItem(null)} />}
    </Layout>
  );
}
