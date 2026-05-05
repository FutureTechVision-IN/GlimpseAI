import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageSquarePlus, Star, X, Loader2, CheckCircle2, Bug, Lightbulb, Heart, MoreHorizontal } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SUPPORT_EMAIL } from "@/lib/support";
import { apiUrl } from "@/lib/api-url";

/**
 * Floating "Send feedback" widget mounted globally inside Layout.
 *
 * Why this is a small popover and not a full-page form:
 * - The bar to giving feedback should be as low as possible. A full route
 *   adds clicks; a slide-out from a fixed pill keeps users in their flow.
 * - Posts to the same `/api/feedback` endpoint regardless of route, attaches
 *   the current `window.location.pathname` so the backend can correlate
 *   complaints / kudos with the surface they came from.
 * - Falls back to a `mailto:` link if the request fails — the user never
 *   loses the ability to contact us.
 */
export function FeedbackWidget(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [category, setCategory] = useState<"bug" | "idea" | "praise" | "other">("idea");
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { toast } = useToast();

  // Auto-focus the textarea when the popover opens (don't yank focus on mount).
  useEffect(() => {
    if (!open) return;
    // Small delay so the open animation can land before focus jumps.
    const t = setTimeout(() => textareaRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [open]);

  // Reset the success state after a moment so the form is ready for another note.
  useEffect(() => {
    if (!submitted) return;
    const t = setTimeout(() => {
      setSubmitted(false);
      setMessage("");
      setRating(null);
      setOpen(false);
    }, 2200);
    return () => clearTimeout(t);
  }, [submitted]);

  function readToken(): string | null {
    try {
      return window.localStorage.getItem("glimpse_token");
    } catch {
      return null;
    }
  }

  async function submitFeedback(): Promise<void> {
    const trimmed = message.trim();
    if (trimmed.length < 3) {
      toast({ title: "Add a few words", description: "Tell us a bit more so we can act on it.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const token = readToken();
      if (token) headers.Authorization = `Bearer ${token}`;

      const resp = await fetch(apiUrl("/api/feedback"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          rating,
          category,
          message: trimmed,
          context: {
            path: typeof window !== "undefined" ? window.location.pathname + window.location.search : null,
            feature: typeof window !== "undefined" ? document.title : null,
          },
        }),
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${resp.status}`);
      }
      setSubmitted(true);
    } catch (err) {
      // Mailto fallback so the user never hits a dead end.
      const subject = encodeURIComponent(`GlimpseAI feedback — ${category}`);
      const body = encodeURIComponent(
        `Rating: ${rating ?? "—"}/5\nCategory: ${category}\nPage: ${typeof window !== "undefined" ? window.location.href : ""}\n\n${trimmed}`,
      );
      toast({
        title: "Couldn't reach our server",
        description: err instanceof Error ? err.message : "Network issue.",
        variant: "destructive",
      });
      window.open(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`, "_blank");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* Floating launcher — always available, never intrusive. */}
      <motion.button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Send feedback"
        aria-expanded={open}
        initial={false}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.96 }}
        className="fixed bottom-4 left-4 z-40 inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/90 px-3.5 py-2 text-xs font-medium text-zinc-200 shadow-lg shadow-black/40 backdrop-blur transition-colors hover:border-teal-500/50 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
      >
        <MessageSquarePlus className="h-3.5 w-3.5 text-teal-400" />
        <span>Feedback</span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ type: "spring", damping: 22, stiffness: 280 }}
            className="fixed bottom-16 left-4 z-50 w-[calc(100vw-2rem)] max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950/95 p-4 shadow-2xl shadow-black/60 backdrop-blur"
            role="dialog"
            aria-labelledby="feedback-widget-title"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 id="feedback-widget-title" className="text-sm font-semibold text-white">
                  Help shape GlimpseAI
                </h2>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  We read every note. Bug, idea, or praise — anything's welcome.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-zinc-500 hover:text-zinc-200"
                aria-label="Close feedback"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {submitted ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mt-4 flex flex-col items-center gap-2 py-6 text-center"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                </div>
                <div className="text-sm font-medium text-zinc-100">Thanks — we got it.</div>
                <p className="text-xs text-zinc-500">Your note is on the team's review list.</p>
              </motion.div>
            ) : (
              <>
                {/* Star rating */}
                <div className="mt-3">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                    Overall rating <span className="text-zinc-700">(optional)</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((n) => {
                      const active = rating !== null && n <= rating;
                      return (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setRating(rating === n ? null : n)}
                          aria-label={`Rate ${n} star${n === 1 ? "" : "s"}`}
                          className="rounded p-1 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                        >
                          <Star
                            className={
                              "h-4 w-4 " +
                              (active ? "fill-amber-400 text-amber-400" : "text-zinc-600 hover:text-amber-300")
                            }
                          />
                        </button>
                      );
                    })}
                    {rating !== null && (
                      <button
                        type="button"
                        onClick={() => setRating(null)}
                        className="ml-1 text-[10px] text-zinc-500 hover:text-zinc-300"
                      >
                        clear
                      </button>
                    )}
                  </div>
                </div>

                {/* Category pills */}
                <div className="mt-3">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">Category</div>
                  <div className="mt-1 grid grid-cols-4 gap-1.5">
                    {(
                      [
                        { id: "bug",    label: "Bug",    Icon: Bug,             color: "text-red-300",     bg: "border-red-500/40 bg-red-500/10" },
                        { id: "idea",   label: "Idea",   Icon: Lightbulb,       color: "text-amber-300",   bg: "border-amber-500/40 bg-amber-500/10" },
                        { id: "praise", label: "Praise", Icon: Heart,           color: "text-pink-300",    bg: "border-pink-500/40 bg-pink-500/10" },
                        { id: "other",  label: "Other",  Icon: MoreHorizontal,  color: "text-zinc-300",    bg: "border-zinc-600/40 bg-zinc-700/10" },
                      ] as const
                    ).map(({ id, label, Icon, color, bg }) => {
                      const active = category === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setCategory(id)}
                          aria-pressed={active}
                          className={
                            "flex flex-col items-center justify-center gap-0.5 rounded-md border px-1.5 py-1.5 text-[10px] transition-all " +
                            (active
                              ? `${bg} ${color}`
                              : "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300")
                          }
                        >
                          <Icon className="h-3.5 w-3.5" />
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Message body */}
                <div className="mt-3">
                  <label htmlFor="feedback-msg" className="text-[10px] uppercase tracking-wider text-zinc-500">
                    What's on your mind?
                  </label>
                  <textarea
                    id="feedback-msg"
                    ref={textareaRef}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={4}
                    maxLength={5000}
                    placeholder="What worked, what didn't, what would feel magical?"
                    className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-teal-500/60 focus:outline-none"
                  />
                  <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-600">
                    <span>{message.length}/5000</span>
                    <span>
                      Tip: paste exact steps for bugs, sketch the dream for ideas
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={submitting || message.trim().length < 3}
                    onClick={() => void submitFeedback()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-r from-teal-500 to-cyan-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition-all hover:from-teal-400 hover:to-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Sending
                      </>
                    ) : (
                      <>Send feedback</>
                    )}
                  </button>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
