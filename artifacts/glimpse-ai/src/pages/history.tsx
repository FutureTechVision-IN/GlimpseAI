import React from "react";
import Layout from "../components/layout";
import { useGetUserHistory } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Image as ImageIcon, Video, Clock, Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function History() {
  const { data: history, isLoading } = useGetUserHistory();

  return (
    <Layout>
      <div className="p-8 max-w-7xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">History</h1>
          <p className="text-zinc-400 mt-1">Your past creative enhancements.</p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array(8).fill(0).map((_, i) => (
              <div key={i} className="aspect-square bg-zinc-900 animate-pulse rounded-xl" />
            ))}
          </div>
        ) : history?.items.length === 0 ? (
          <div className="text-center py-20 bg-zinc-950/50 rounded-2xl border border-zinc-800 border-dashed">
            <ImageIcon className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
            <h3 className="text-xl font-medium mb-2">No history yet</h3>
            <p className="text-zinc-500">Your enhanced photos and videos will appear here.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {history?.items.map(job => (
              <Card key={job.id} className="group overflow-hidden border-zinc-800 bg-zinc-950 hover:border-zinc-700 transition-colors">
                <div className="aspect-square relative bg-zinc-900 flex items-center justify-center">
                  {job.thumbnailUrl ? (
                    <img src={job.thumbnailUrl} alt={job.filename} className="w-full h-full object-cover" />
                  ) : job.processedUrl ? (
                    job.mediaType === "video" ? (
                      <video src={job.processedUrl} className="w-full h-full object-cover" muted />
                    ) : (
                      <img src={job.processedUrl} alt={job.filename} className="w-full h-full object-cover" />
                    )
                  ) : (
                    <div className="text-zinc-700">
                      {job.mediaType === "video" ? <Video className="w-8 h-8" /> : <ImageIcon className="w-8 h-8" />}
                    </div>
                  )}

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
                  </div>
                  
                  <div className="absolute top-2 left-2 px-2 py-1 rounded bg-black/60 backdrop-blur text-[10px] font-medium uppercase tracking-wider text-zinc-300">
                    {job.mediaType}
                  </div>
                  <div className={`absolute top-2 right-2 px-2 py-1 rounded bg-black/60 backdrop-blur text-[10px] font-medium uppercase tracking-wider ${job.status === 'completed' ? 'text-emerald-400' : job.status === 'failed' ? 'text-red-400' : 'text-blue-400'}`}>
                    {job.status}
                  </div>
                </div>
                <div className="p-3">
                  <div className="truncate text-sm font-medium" title={job.filename}>{job.filename}</div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-zinc-500 capitalize">{job.enhancementType}</span>
                    <span className="text-xs text-zinc-500">{new Date(job.createdAt).toLocaleDateString()}</span>
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
