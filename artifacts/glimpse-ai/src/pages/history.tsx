import React, { useState, useEffect, useCallback } from "react";
import Layout from "../components/layout";
import { Card } from "@/components/ui/card";
import { Image as ImageIcon, Download, Trash2, Trash, HardDrive, Info, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  getHistory,
  deleteHistoryItem,
  clearHistory,
  LocalHistoryItem,
} from "@/lib/local-history";
import { Link } from "wouter";

export default function History() {
  const [items, setItems] = useState<LocalHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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
      const ext = item.mimeType === "image/png" ? ".png" : item.mimeType === "image/webp" ? ".webp" : ".jpg";
      const baseName = item.filename.replace(/\.[^.]+$/, "");
      a.download = `enhanced-${baseName}${ext}`;
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
            {items.map(item => (
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

                  {/* Type badge */}
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/60 backdrop-blur text-[10px] font-medium uppercase tracking-wider text-zinc-300">
                    Photo
                  </div>
                </div>

                <div className="p-3">
                  <div className="truncate text-sm font-medium" title={item.filename}>{item.filename}</div>
                  <div className="flex items-center justify-between mt-1">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-zinc-700 text-zinc-500 capitalize">
                      {item.enhancementType}
                    </Badge>
                    <span className="text-xs text-zinc-600">{new Date(item.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
