/**
 * AiChatWidget — shared floating AI assistant
 * Used on Dashboard, Admin, and as a standalone panel.
 * Context-aware: responds differently based on `context` prop.
 */
import React, { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Sparkles, X, Send, Loader2, BrainCircuit, BarChart3 } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatContext = "editor" | "dashboard" | "admin";

interface ChatMessage {
  id: number;
  role: "ai" | "user";
  text: string;
}

interface Props {
  context: ChatContext;
  /** Optional stats available at the call-site (for admin context) */
  adminStats?: {
    totalUsers?: number;
    totalJobs?: number;
    avgConfidence?: number;
    topEnhancement?: string;
  };
}

// ---------------------------------------------------------------------------
// Platform knowledge base — enhancement descriptions
// ---------------------------------------------------------------------------

const ENHANCEMENT_KNOWLEDGE: Record<string, string> = {
  auto: "Auto Enhance is our one-click AI magic. It analyses brightness, contrast, saturation, and colour temperature, then applies an optimal combination of adjustments tailored to the specific image.",
  portrait: "Portrait Polish smooths skin texture naturally, warms complexion tones, and enhances facial detail without the over-processed 'beauty filter' look. Great for headshots and selfies.",
  lighting_enhance: "Fix Lighting recovers underexposed shadows and tames blown highlights using a multi-scale tone-mapping algorithm. Perfect for dark or harsh-lit photos.",
  color_grade_cinematic: "Cinematic Grade applies film-inspired colour treatment — lifted blacks, teal shadows, and warm skin tones — to create that professional blockbuster look.",
  color_grade_warm: "Warm Tones shifts the colour palette toward golden ambers and sunset hues. Ideal for portraits, lifestyle shots, and food photography.",
  color_grade_cool: "Cool Tones creates a crisp, modern blue-shift palette favoured in architectural, fashion, and urban photography.",
  blur_background: "Background Blur simulates a shallow depth-of-field (bokeh) effect by detecting the subject and progressively blurring the background.",
  skin_retouch: "Skin Retouch uses a frequency-separation technique to smooth imperfections while preserving natural skin texture and pores.",
  upscale: "2× AI Upscale doubles the image resolution using AI interpolation, recovering fine detail that's lost in low-resolution originals.",
  upscale_4x: "4× AI Upscale quadruples resolution — ideal for printing large format or restoring heavily compressed images.",
};

const FILTER_KNOWLEDGE: Record<string, string> = {
  vivid: "Vivid boosts saturation and contrast to make colours pop. Best for landscapes, travel, and product shots.",
  cinematic: "Cinematic applies a film-grade colour matrix with teal shadows and warm highlights.",
  film: "Film simulates the grain and colour shift of classic 35mm film stock.",
  vintage: "Vintage adds a faded, nostalgic look with lifted blacks and warm toning.",
  moody: "Moody crushes blacks and desaturates mid-tones for a dramatic, introspective atmosphere.",
  goldenhour: "Golden Hour intensifies warm sunset tones — perfect for outdoor portraits and landscape photography.",
  dramatic: "Dramatic increases contrast and deepens shadows to create a high-impact visual.",
  airy: "Airy lifts shadows and cools highlights for a bright, soft, editorial feel.",
  bw: "Black & White desaturates the image with a silver-toned finish and enhanced contrast.",
  portrait: "Portrait filter applies a subtle soft-focus and skin-warm effect ideal for professional headshots.",
  hdr: "HDR filter blends multiple exposures for maximum shadow and highlight detail.",
};

// ---------------------------------------------------------------------------
// Context-specific welcome messages
// ---------------------------------------------------------------------------

const WELCOME_MESSAGES: Record<ChatContext, string> = {
  editor: "Hi! I'm your AI editing assistant. Upload a photo and I'll suggest the perfect enhancement, or ask me anything.",
  dashboard: "Hi! I'm your GlimpseAI assistant. I can answer questions about enhancements, filters, usage, pricing, or help you get the most from GlimpseAI.",
  admin: "Hi! I'm the GlimpseAI Admin Assistant. I can help you understand analytics, enhancement performance, AI provider health, and platform insights.",
};

// ---------------------------------------------------------------------------
// Response generator — NLP pattern matching with platform knowledge
// ---------------------------------------------------------------------------

function generateResponse(input: string, context: ChatContext, adminStats?: Props["adminStats"]): string {
  const lower = input.toLowerCase();

  // --- Greetings ---
  if (/^(hi|hello|hey|howdy|sup|good (morning|afternoon|evening)|yo\b)/i.test(lower)) {
    return WELCOME_MESSAGES[context];
  }

  // --- Help / capabilities ---
  if (/help|what can you|capabilities|features|guide|tutorial/i.test(lower)) {
    if (context === "admin") {
      return "As admin assistant, I can help with:\n\n📊 Analytics & usage trends\n🤖 AI provider health & key status\n👥 User growth & conversion rates\n🎨 Which enhancements are most popular\n⚙️ Platform configuration guidance\n\nWhat would you like to know?";
    }
    return "Here's what GlimpseAI offers:\n\n✨ Quick Enhance — 10 one-click AI enhancements\n🎨 Filter Gallery — 29 creative filters\n📐 AI Upscale — 2× and 4× resolution boost\n👤 Portrait Polish & Skin Retouch\n🎬 Cinematic, Warm, Cool colour grades\n💡 Fix Lighting — intelligent exposure recovery\n\nNavigate to the Editor to get started. Ask me about any specific enhancement!";
  }

  // --- Enhancement queries ---
  for (const [key, desc] of Object.entries(ENHANCEMENT_KNOWLEDGE)) {
    const aliases: Record<string, RegExp> = {
      auto: /\bauto( enhance)?\b/i,
      portrait: /portrait( polish)?\b/i,
      lighting_enhance: /fix lighting|lighting( enhance)?\b|exposure|underexposed|dark photo/i,
      color_grade_cinematic: /cinematic( grade)?\b|film.?grade|movie look/i,
      color_grade_warm: /warm( tones?)?\b|golden|cozy/i,
      color_grade_cool: /cool( tones?)?\b|cold|blue tone/i,
      blur_background: /blur( background)?\b|bokeh|depth.?of.?field/i,
      skin_retouch: /skin( retouch)?\b|retouch|blemish/i,
      upscale: /\b2x\b|upscale|increase resolution|enlarge|super.?res/i,
      upscale_4x: /\b4x\b|quad.?(scale|res)/i,
    };
    if (aliases[key]?.test(lower)) {
      return desc + (context !== "admin"
        ? `\n\n💡 ${key.includes("upscale") ? "Find it in Quick Enhance → 2x/4x Upscale buttons." : "Find it in Quick Enhance on the left panel."}`
        : "");
    }
  }

  // --- Filter queries ---
  for (const [key, desc] of Object.entries(FILTER_KNOWLEDGE)) {
    if (lower.includes(key) || lower.includes(key.replace("_", " "))) {
      return desc + (context !== "admin" ? "\n\n🎨 Find it in the Filter Gallery section of the Editor." : "");
    }
  }

  // --- Export / Download ---
  if (/export|download|save( image)?|how to save/i.test(lower)) {
    return "To export your enhanced image:\n\n1. Upload a photo in the Editor\n2. Select a Quick Enhance or Filter\n3. Click **Enhance & Export** (visible immediately) or wait for processing then click **Export**\n4. Keyboard shortcut: ⌘S (Mac) / Ctrl+S (Windows)\n\nImages are saved in the original format (JPEG, PNG, or WebP).";
  }

  // --- Pricing / Plans ---
  if (/pric|plan|subscri|free|paid|upgrade|credit/i.test(lower)) {
    return "GlimpseAI offers:\n\n🆓 Free tier — limited monthly enhancements\n⚡ Pro — unlimited enhancements, priority processing\n🏢 Enterprise — team accounts, API access, custom branding\n\nVisit the Billing page for current plan details.";
  }

  // --- API / Key status (admin context) ---
  if (context === "admin" && /api.?key|provider|openrouter|gemini|degraded|circuit/i.test(lower)) {
    return "AI provider status is visible under Admin → AI Insights → Provider Health.\n\n**Current architecture:**\n• Local Sharp analysis (always active, 0.75–0.92 confidence)\n• OpenRouter free tier (vision models, daily quota)\n• Gemini API (fallback)\n\n**About 'degraded' keys:** Free-tier OpenRouter keys hit a daily request cap. The system automatically uses local Sharp-based analysis as a high-confidence fallback, so enhancement quality is maintained even when API keys are exhausted.\n\nTo resolve: Add $10 credits to your OpenRouter account to unlock 1000+ daily requests per key.";
  }

  // --- Confidence / accuracy ---
  if (/confidence|accurate|how good|precision|reliability/i.test(lower)) {
    return "GlimpseAI's AI analysis uses a layered approach:\n\n🏠 **Local analysis** (always runs): Uses Sharp image statistics to achieve 0.75–0.92 confidence based on brightness, contrast, saturation, aspect ratio, and colour temperature.\n\n🤖 **Cloud AI** (when available): OpenRouter vision models or Gemini API enrich the local analysis with contextual descriptions.\n\nThis means you'll always see a high-confidence recommendation, even when external APIs are rate-limited.";
  }

  // --- Admin analytics ---
  if (context === "admin") {
    if (/user|signup|growth|register/i.test(lower)) {
      return adminStats?.totalUsers
        ? `The platform has **${adminStats.totalUsers} registered users**. Check the Overview tab for full signup trends, conversion rates, and retention metrics.`
        : "User metrics are available in the Admin Overview and Analytics tabs. Look for the Users card and the 30-day trend chart.";
    }
    if (/job|process|enhancement|popular/i.test(lower)) {
      return adminStats?.topEnhancement
        ? `Most popular enhancement: **${adminStats.topEnhancement}**. Visit AI Insights → Top Enhancements for the full breakdown.`
        : "Job analytics are in the AI Insights tab — you can see which enhancements are applied most, acceptance rates, and per-category performance.";
    }
    if (/revenue|payment|money|billing/i.test(lower)) {
      return "Revenue data is in Admin → Payments. You can see transaction history, revenue trends, and plan distribution from the Overview cards.";
    }
  }

  // --- What is GlimpseAI ---
  if (/what is glimpse|about glimpse|platform/i.test(lower)) {
    return "GlimpseAI is an AI-powered media enhancement platform. It offers:\n\n🎨 10 quick enhancement types (portrait, cinematic, lighting, upscale...)\n🖼️ 29 creative filters\n🤖 AI-powered image analysis with intelligent recommendations\n📦 Batch processing via API\n🔒 Secure, server-side processing (images never leave your control)\n\nThe editor supports photos (up to 100 MB) and videos.";
  }

  // --- Fallback ---
  return context === "admin"
    ? "I can help with analytics, AI provider health, enhancement performance, user metrics, and platform configuration. What would you like to explore?"
    : "I can answer questions about enhancements, filters, export, pricing, and how to get the best results from your photos. What would you like to know?";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AiChatWidget({ context, adminStats }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const idRef = useRef(0);

  const handleSend = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;

    const userId = ++idRef.current;
    setMessages(prev => [...prev, { id: userId, role: "user", text }]);
    setInput("");
    setIsTyping(true);

    setTimeout(() => {
      const aiId = ++idRef.current;
      const response = generateResponse(text, context, adminStats);
      setMessages(prev => [...prev, { id: aiId, role: "ai", text: response }]);
      setIsTyping(false);
    }, 400);
  }, [input, context, adminStats]);

  const handleOpen = useCallback(() => {
    setIsOpen(true);
    if (messages.length === 0) {
      setTimeout(() => {
        const aiId = ++idRef.current;
        setMessages([{ id: aiId, role: "ai", text: WELCOME_MESSAGES[context] }]);
      }, 200);
    }
  }, [messages.length, context]);

  const icon = context === "admin" ? <BrainCircuit className="w-5 h-5" /> :
               context === "dashboard" ? <BarChart3 className="w-5 h-5" /> :
               <Sparkles className="w-5 h-5" />;

  const label = context === "admin" ? "Admin AI" : "GlimpseAI";

  return (
    <>
      {/* Floating panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.95 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed bottom-20 right-4 w-80 h-[440px] bg-zinc-950/95 backdrop-blur-lg border border-white/10 rounded-2xl flex flex-col z-50 shadow-2xl shadow-black/60"
          >
            {/* Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between shrink-0 rounded-t-2xl">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-teal-500/20 flex items-center justify-center">
                  <Sparkles className="w-3.5 h-3.5 text-teal-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{label} Assistant</p>
                  <p className="text-[10px] text-zinc-500">Powered by GlimpseAI</p>
                </div>
              </div>
              <button onClick={() => setIsOpen(false)} className="text-zinc-600 hover:text-zinc-300 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 p-3">
              <div className="space-y-3">
                {messages.map(msg => (
                  <div key={msg.id} className={cn("flex items-start gap-2", msg.role === "user" && "flex-row-reverse")}>
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold",
                      msg.role === "ai" ? "bg-teal-500/20 text-teal-400" : "bg-cyan-500/20 text-cyan-400"
                    )}>
                      {msg.role === "ai" ? <Sparkles className="w-3 h-3" /> : "U"}
                    </div>
                    <div className={cn(
                      "max-w-[220px] rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-line",
                      msg.role === "ai"
                        ? "bg-zinc-900 border border-zinc-800 rounded-tl-none text-zinc-300"
                        : "bg-teal-600/20 border border-teal-500/20 rounded-tr-none text-teal-100"
                    )}>
                      {msg.text}
                    </div>
                  </div>
                ))}
                {isTyping && (
                  <div className="flex items-start gap-2">
                    <div className="w-6 h-6 rounded-full bg-teal-500/20 flex items-center justify-center shrink-0">
                      <Loader2 className="w-3 h-3 text-teal-400 animate-spin" />
                    </div>
                    <div className="bg-zinc-900 border border-zinc-800 rounded-xl rounded-tl-none px-3 py-2 text-xs text-zinc-500">
                      Thinking…
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Quick suggestions */}
            {messages.length <= 1 && (
              <div className="px-3 pb-2 flex flex-wrap gap-1">
                {(context === "admin"
                  ? ["API key status", "Top enhancements", "User metrics"]
                  : ["What can you do?", "How do I export?", "Best filter for portraits"]
                ).map(s => (
                  <button
                    key={s}
                    className="text-[10px] px-2 py-1 rounded-full border border-zinc-700 text-zinc-400 hover:border-teal-500 hover:text-teal-300 transition-colors"
                    onClick={() => {
                      const userId = ++idRef.current;
                      setMessages(prev => [...prev, { id: userId, role: "user", text: s }]);
                      setIsTyping(true);
                      setTimeout(() => {
                        const aiId = ++idRef.current;
                        setMessages(prev => [...prev, { id: aiId, role: "ai", text: generateResponse(s, context, adminStats) }]);
                        setIsTyping(false);
                      }, 400);
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Input */}
            <div className="p-3 border-t border-white/10 shrink-0 rounded-b-2xl">
              <form onSubmit={handleSend} className="flex items-center gap-2">
                <Input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="Ask me anything…"
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

      {/* Toggle button */}
      <motion.button
        onClick={isOpen ? () => setIsOpen(false) : handleOpen}
        className={cn(
          "fixed bottom-4 right-4 z-50 w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all",
          isOpen
            ? "bg-zinc-800 border border-white/10 text-zinc-400 hover:text-white"
            : "bg-teal-600 hover:bg-teal-500 text-white shadow-[0_0_20px_rgba(20,184,166,0.4)]"
        )}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
      >
        {isOpen ? <X className="w-5 h-5" /> : icon}
      </motion.button>
    </>
  );
}
