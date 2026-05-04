import React, { useCallback, useEffect, useState } from "react";
import { Bug, Heart, Lightbulb, Loader2, MoreHorizontal, RefreshCw, Star, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/**
 * Admin triage view over the persisted `feedback_entries` table. The page
 * deliberately leans on filterable lists rather than charts — the goal is
 * to make every note actionable, not to replace product analytics.
 */

interface FeedbackEntry {
  id: number;
  userId: number | null;
  userRole: string | null;
  rating: number | null;
  category: "bug" | "idea" | "praise" | "other";
  message: string;
  contextPath: string | null;
  contextFeature: string | null;
  status: "new" | "reviewing" | "actioned" | "dismissed";
  resolutionNote: string | null;
  createdAt: string;
}

interface ListResponse {
  items: FeedbackEntry[];
  counts: Record<string, number>;
}

const CATEGORY_META: Record<FeedbackEntry["category"], { label: string; tone: string; Icon: React.ElementType }> = {
  bug:    { label: "Bug",    tone: "text-rose-300 border-rose-500/40 bg-rose-500/10", Icon: Bug },
  idea:   { label: "Idea",   tone: "text-amber-300 border-amber-500/40 bg-amber-500/10", Icon: Lightbulb },
  praise: { label: "Praise", tone: "text-pink-300 border-pink-500/40 bg-pink-500/10", Icon: Heart },
  other:  { label: "Other",  tone: "text-zinc-300 border-zinc-700 bg-zinc-800/40", Icon: MoreHorizontal },
};

function authHeader(): Record<string, string> {
  const token = typeof window !== "undefined" ? window.localStorage.getItem("glimpse_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatTime(iso: string): string {
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }); }
  catch { return iso; }
}

export function FeedbackPanel(): React.ReactElement {
  const { toast } = useToast();
  const [items, setItems] = useState<FeedbackEntry[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<string>("new");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<FeedbackEntry | null>(null);
  const [resolutionDraft, setResolutionDraft] = useState("");

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("limit", "100");
      if (statusFilter && statusFilter !== "all") qs.set("status", statusFilter);
      if (categoryFilter) qs.set("category", categoryFilter);
      const resp = await fetch(`/api/admin/feedback?${qs.toString()}`, { headers: authHeader() });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as ListResponse;
      setItems(data.items ?? []);
      setCounts(data.counts ?? {});
    } catch (err) {
      toast({
        title: "Couldn't load feedback",
        description: err instanceof Error ? err.message : "Network issue.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, categoryFilter, toast]);

  useEffect(() => { void fetchEntries(); }, [fetchEntries]);

  const updateEntry = useCallback(async (id: number, patch: Partial<{ status: string; resolutionNote: string }>) => {
    try {
      const resp = await fetch(`/api/admin/feedback/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify(patch),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const updated = ((await resp.json()) as { item: FeedbackEntry }).item;
      setItems((rows) => rows.map((r) => (r.id === id ? updated : r)));
      setSelected((s) => (s && s.id === id ? updated : s));
      void fetchEntries();
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Network issue.",
        variant: "destructive",
      });
    }
  }, [fetchEntries, toast]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-zinc-50">User feedback</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Triage incoming notes by category and status. Closing the loop here directly improves NPS.
          </p>
        </div>
        <button
          onClick={() => void fetchEntries()}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {(["new", "reviewing", "actioned", "dismissed", "all"] as const).map((s) => {
          const active = statusFilter === s;
          const label = s === "all" ? "All" : s[0].toUpperCase() + s.slice(1);
          const count = s === "all" ? items.length : counts[s] ?? 0;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={
                "rounded-full px-3 py-1 text-xs font-medium transition-colors " +
                (active
                  ? "bg-teal-500 text-zinc-950"
                  : "border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800")
              }
            >
              {label} <span className={active ? "text-zinc-900/70" : "text-zinc-500"}>({count})</span>
            </button>
          );
        })}
        <span className="mx-2 h-4 w-px bg-zinc-800" />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
        >
          <option value="">All categories</option>
          <option value="bug">Bug</option>
          <option value="idea">Idea</option>
          <option value="praise">Praise</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950">
        {loading && items.length === 0 ? (
          <div className="flex items-center gap-2 p-8 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-400">
            No feedback in this lane.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {items.map((it) => {
              const meta = CATEGORY_META[it.category];
              return (
                <li
                  key={it.id}
                  className={`cursor-pointer p-4 hover:bg-zinc-900/60 ${selected?.id === it.id ? "bg-zinc-900/80" : ""}`}
                  onClick={() => { setSelected(it); setResolutionDraft(it.resolutionNote ?? ""); }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${meta.tone}`}>
                      <meta.Icon className="h-3 w-3" /> {meta.label}
                    </span>
                    {it.rating !== null && (
                      <span className="inline-flex items-center gap-0.5 text-amber-300">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Star key={n} className={`h-3 w-3 ${n <= (it.rating ?? 0) ? "fill-amber-400" : "text-zinc-700"}`} />
                        ))}
                      </span>
                    )}
                    <span className="rounded-full border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-300">
                      {it.status}
                    </span>
                    <span className="ml-auto text-[10px] text-zinc-500">{formatTime(it.createdAt)}</span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-zinc-100">{it.message}</p>
                  <p className="mt-1 text-[11px] text-zinc-400">
                    {it.userId ? `User #${it.userId}` : "Anonymous"} · {it.contextPath ?? "—"}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={() => setSelected(null)}>
          <aside
            className="h-full w-full max-w-lg overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${CATEGORY_META[selected.category].tone}`}>
                    {CATEGORY_META[selected.category].label}
                  </span>
                  <span className="rounded-full border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-300">{selected.status}</span>
                </div>
                <h3 className="mt-2 text-base font-semibold text-zinc-50">Feedback #{selected.id}</h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {selected.userId ? `User #${selected.userId} (${selected.userRole ?? "user"})` : "Anonymous"} · {formatTime(selected.createdAt)}
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <section className="mt-5 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <h4 className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Message</h4>
              <p className="whitespace-pre-wrap text-sm text-zinc-100">{selected.message}</p>
              {selected.contextPath && (
                <p className="mt-2 text-[11px] text-zinc-400 font-mono">From: {selected.contextPath}</p>
              )}
            </section>

            <section className="mt-3">
              <label className="text-[10px] uppercase tracking-wider text-zinc-500">Resolution note (internal)</label>
              <textarea
                rows={3}
                value={resolutionDraft}
                onChange={(e) => setResolutionDraft(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
                placeholder="What did we do about this?"
              />
              <button
                onClick={() => void updateEntry(selected.id, { resolutionNote: resolutionDraft })}
                className="mt-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:border-zinc-600"
              >
                Save note
              </button>
            </section>

            <div className="mt-5 flex flex-wrap gap-2">
              {(["reviewing", "actioned", "dismissed"] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => void updateEntry(selected.id, { status })}
                  className={
                    "rounded-md border px-3 py-1.5 text-xs " +
                    (selected.status === status
                      ? "border-teal-500/60 bg-teal-500/10 text-teal-200"
                      : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-600")
                  }
                >
                  Mark {status}
                </button>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
