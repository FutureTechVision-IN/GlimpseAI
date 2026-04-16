import React, { useState, useEffect } from "react";
import Layout from "../components/layout";
import { 
  useUploadMedia, 
  useEnhanceMedia, 
  useListPresets, 
  useGetMediaJob,
  UploadMediaBodyMediaType,
  EnhanceMediaBodyEnhancementType
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { UploadCloud, Wand2, Image as ImageIcon, Video, Settings2, Download, RefreshCw, Sparkles, Loader2, Play } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function Editor() {
  const [file, setFile] = useState<File | null>(null);
  const [base64Data, setBase64Data] = useState<string>("");
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [mediaType, setMediaType] = useState<UploadMediaBodyMediaType>("photo");
  const [enhancementType, setEnhancementType] = useState<EnhanceMediaBodyEnhancementType>("auto");
  const [presetId, setPresetId] = useState<number | undefined>(undefined);
  const [currentJobId, setCurrentJobId] = useState<number | null>(null);

  const { toast } = useToast();
  const uploadMedia = useUploadMedia();
  const enhanceMedia = useEnhanceMedia();
  const { data: presets } = useListPresets({ type: mediaType });
  const { data: currentJob, refetch: refetchJob } = useGetMediaJob(currentJobId as number, {
    query: {
      enabled: !!currentJobId,
      queryKey: ["mediaJob", currentJobId],
      refetchInterval: (query) => {
        // Stop polling if completed or failed
        const status = query.state.data?.status;
        if (status === "completed" || status === "failed") return false;
        return 2000; // Poll every 2 seconds
      }
    }
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setMediaType(selectedFile.type.startsWith("video") ? "video" : "photo");
    setPreviewUrl(URL.createObjectURL(selectedFile));
    setCurrentJobId(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      // Extract base64 part
      const base64 = result.split(",")[1];
      setBase64Data(base64);
    };
    reader.readAsDataURL(selectedFile);
  };

  const handleProcess = () => {
    if (!file || !base64Data) return;

    uploadMedia.mutate(
      {
        data: {
          filename: file.name,
          mimeType: file.type,
          size: file.size,
          mediaType: mediaType,
          base64Data: base64Data
        }
      },
      {
        onSuccess: (job) => {
          setCurrentJobId(job.id);
          enhanceMedia.mutate({
            data: {
              jobId: job.id,
              enhancementType: enhancementType,
              presetId: presetId
            }
          }, {
            onError: (err: any) => {
              toast({ title: "Enhancement failed", description: err.error || "Failed to start enhancement", variant: "destructive" });
            }
          });
        },
        onError: (err: any) => {
          toast({ title: "Upload failed", description: err.error || "Failed to upload file", variant: "destructive" });
        }
      }
    );
  };

  const isProcessing = currentJob?.status === "processing" || currentJob?.status === "pending" || uploadMedia.isPending || enhanceMedia.isPending;
  const isCompleted = currentJob?.status === "completed";

  return (
    <Layout>
      <div className="flex flex-col lg:flex-row h-full min-h-[calc(100vh-4rem)]">
        {/* Editor Sidebar */}
        <aside className="w-full lg:w-80 border-r border-white/10 bg-zinc-950 flex flex-col">
          <div className="p-4 border-b border-white/10">
            <h2 className="font-semibold text-lg flex items-center gap-2">
              <Settings2 className="w-5 h-5 text-teal-500" />
              Enhancement Settings
            </h2>
          </div>
          
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-6">
              {/* Enhancement Type Selection */}
              <div className="space-y-3">
                <Label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Enhancement Type</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(["auto", "upscale", "portrait", "color", "lighting"] as EnhanceMediaBodyEnhancementType[]).map(type => (
                    <Button 
                      key={type}
                      variant="outline" 
                      size="sm"
                      className={`justify-start capitalize border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 ${enhancementType === type ? 'border-teal-500 text-teal-400 bg-teal-500/10 hover:bg-teal-500/20' : ''}`}
                      onClick={() => setEnhancementType(type)}
                    >
                      {type === "auto" && <Wand2 className="w-3 h-3 mr-2" />}
                      {type}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Presets */}
              {presets && presets.length > 0 && (
                <div className="space-y-3">
                  <Label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Style Presets</Label>
                  <div className="grid grid-cols-1 gap-2">
                    {presets.map(preset => (
                      <Button 
                        key={preset.id}
                        variant="outline" 
                        size="sm"
                        className={`justify-start border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 ${presetId === preset.id ? 'border-teal-500 text-teal-400 bg-teal-500/10' : ''}`}
                        onClick={() => setPresetId(preset.id === presetId ? undefined : preset.id)}
                      >
                        <Sparkles className={`w-3 h-3 mr-2 ${preset.isPremium ? 'text-amber-400' : ''}`} />
                        {preset.name}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="p-4 border-t border-white/10 bg-zinc-950">
            <Button 
              className="w-full bg-teal-600 hover:bg-teal-700 text-white shadow-lg shadow-teal-500/20"
              onClick={handleProcess}
              disabled={!file || isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4 mr-2" />
                  Enhance Media
                </>
              )}
            </Button>
          </div>
        </aside>

        {/* Main Preview Area */}
        <main className="flex-1 bg-zinc-900 relative flex flex-col">
          <div className="flex-1 flex items-center justify-center p-8 overflow-hidden">
            {!file ? (
              <div className="max-w-md w-full">
                <Card className="border-dashed border-2 border-zinc-800 bg-zinc-950/50 hover:bg-zinc-900/50 hover:border-zinc-700 transition-colors cursor-pointer relative overflow-hidden group">
                  <input 
                    type="file" 
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
                    accept="image/*,video/*"
                    onChange={handleFileChange}
                  />
                  <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="w-16 h-16 bg-zinc-900 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                      <UploadCloud className="w-8 h-8 text-zinc-400" />
                    </div>
                    <h3 className="text-xl font-semibold mb-2">Upload Media</h3>
                    <p className="text-zinc-500 text-sm mb-4">Drag and drop or click to browse</p>
                    <div className="flex items-center gap-4 text-xs text-zinc-600">
                      <span className="flex items-center gap-1"><ImageIcon className="w-3 h-3" /> Photos</span>
                      <span className="flex items-center gap-1"><Video className="w-3 h-3" /> Videos</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="relative w-full h-full flex flex-col items-center justify-center">
                <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setFile(null); setPreviewUrl(""); setCurrentJobId(null); }} className="bg-black/50 backdrop-blur border-white/10 hover:bg-white/10">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    New Upload
                  </Button>
                  {isCompleted && currentJob?.processedUrl && (
                    <a href={currentJob.processedUrl} target="_blank" rel="noreferrer" download>
                      <Button size="sm" className="bg-white text-black hover:bg-white/90 shadow-lg">
                        <Download className="w-4 h-4 mr-2" />
                        Export
                      </Button>
                    </a>
                  )}
                </div>

                <div className="relative max-w-full max-h-full rounded-lg overflow-hidden border border-white/10 shadow-2xl bg-black flex items-center justify-center">
                  {isProcessing && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center z-20">
                      <Loader2 className="w-10 h-10 text-teal-500 animate-spin mb-4" />
                      <div className="text-lg font-medium">Applying Magic...</div>
                      <div className="text-sm text-zinc-400 mt-2">This may take a few moments</div>
                    </div>
                  )}

                  {isCompleted && currentJob?.processedUrl ? (
                    mediaType === "video" ? (
                      <video src={currentJob.processedUrl} controls className="max-w-full max-h-full object-contain" autoPlay loop muted />
                    ) : (
                      <img src={currentJob.processedUrl} alt="Enhanced" className="max-w-full max-h-[80vh] object-contain" />
                    )
                  ) : (
                    mediaType === "video" ? (
                      <video src={previewUrl} controls className="max-w-full max-h-full object-contain" />
                    ) : (
                      <img src={previewUrl} alt="Original" className="max-w-full max-h-[80vh] object-contain opacity-70" />
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </Layout>
  );
}
