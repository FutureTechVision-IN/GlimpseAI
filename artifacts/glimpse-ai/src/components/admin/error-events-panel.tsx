import React, { useCallback, useEffect, useState } from "react";
import { AlertOctagon, AlertTriangle, Bell, BookOpen, CheckCircle2, ChevronRight, Loader2, RefreshCw, ShieldAlert, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/**
 * Admin-facing panel that surfaces structured error events written by
 * `error-envelope.ts`. Built around a triage queue with severity badges and
 * actionable resolution hints — admins should never have to grep server logs
 * to figure out why a customer purchase failed.
 *
 * Renders inside the admin shell as a section. The accompanying toaster
 * (`useAdminErrorPolling`) lives outside this component so it can fire from
 * any admin page.
 */

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
  wont_fix: "Won't fix",
};

const SEVERITY_STYLE: Record<string, { ring: string; chip: string; icon: React.ElementType }> = {
  critical: { ring: "border-rose-500/50 bg-rose-500/10", chip: "bg-rose-500 text-zinc-950", icon: AlertOctagon },
  high:     { ring: "border-amber-500/50 bg-amber-500/10", chip: "bg-amber-500 text-zinc-950", icon: AlertTriangle },
  medium:   { ring: "border-cyan-500/40 bg-cyan-500/5",   chip: "bg-cyan-500 text-zinc-950",   icon: ShieldAlert },
  low:      { ring: "border-zinc-700 bg-zinc-900",        chip: "bg-zinc-600 text-zinc-100",   icon: Bell },
};

interface ErrorEvent {
  id: number;
  code: string;
  userMessage: string;
  adminDetail: string;
  severity: keyof typeof SEVERITY_STYLE;
  surface: string | null;
  routePath: string | null;
  httpStatus: number | null;
  requestId: string | null;
  suggestedResolution: string | null;
  metadata: Record<string, unknown> | null;
  status: string;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

interface ListResponse {
  items: ErrorEvent[];
  counts: Record<string, number>;
}

function authHeader(): Record<string, string> {
  const token = typeof window !== "undefined" ? window.localStorage.getItem("glimpse_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function ErrorEventsPanel(): React.ReactElement {
  const { toast } = useToast();
  const [items, setItems] = useState<ErrorEvent[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ErrorEvent | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const url = statusFilter === "all"
        ? "/api/admin/error-events?limit=100"
        : `/api/admin/error-events?limit=100&status=${encodeURIComponent(statusFilter)}`;
      const resp = await fetch(url, { headers: authHeader() });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as ListResponse;
      setItems(data.items ?? []);
      setCounts(data.counts ?? {});
    } catch (err) {
      toast({
        title: "Couldn't load error events",
        description: err instanceof Error ? err.message : "Network issue.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, toast]);

  useEffect(() => { void fetchEvents(); }, [fetchEvents]);

  const updateStatus = useCallback(async (id: number, status: string): Promise<void> => {
    try {
      const resp = await fetch(`/api/admin/error-events/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ status }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const updated = ((await resp.json()) as { item: ErrorEvent }).item;
      setItems((rows) => rows.map((r) => (r.id === id ? updated : r)));
      setSelected((s) => (s && s.id === id ? updated : s));
      void fetchEvents();
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Network issue.",
        variant: "destructive",
      });
    }
  }, [fetchEvents, toast]);

  // Allow deep-link from anywhere in admin: /admin#error-events/:id
  useEffect(() => {
    function applyHash(): void {
      const m = window.location.hash.match(/^#error-events\/(\d+)/);
      if (!m) return;
      const id = Number(m[1]);
      const found = items.find((it) => it.id === id);
      if (found) setSelected(found);
    }
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-zinc-50">Error events</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Customer-impacting failures with friendly user copy and admin runbooks.
          </p>
        </div>
        <button
          onClick={() => void fetchEvents()}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Status filter pills with counts */}
      <div className="flex flex-wrap gap-1.5">
        {(["open", "acknowledged", "resolved", "wont_fix", "all"] as const).map((s) => {
          const active = statusFilter === s;
          const label = s === "all" ? "All" : STATUS_LABEL[s];
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
      </div>

      {/* List */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950">
        {loading && items.length === 0 ? (
          <div className="flex items-center gap-2 p-8 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-400">
            <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-400" />
            Nothing in this lane right now — system is quiet.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {items.map((ev) => {
              const sev = SEVERITY_STYLE[ev.severity] ?? SEVERITY_STYLE.medium;
              const Icon = sev.icon;
              return (
                <li
                  key={ev.id}
                  className={`flex cursor-pointer items-start gap-3 p-4 hover:bg-zinc-900/60 ${selected?.id === ev.id ? "bg-zinc-900/80" : ""}`}
                  onClick={() => setSelected(ev)}
                >
                  <div className={`mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md border ${sev.ring}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${sev.chip}`}>
                        {ev.severity}
                      </span>
                      <span className="font-mono text-[11px] text-zinc-300">{ev.code}</span>
                      {ev.surface && (
                        <span className="rounded-full border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-300">
                          {ev.surface}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-zinc-500">{formatTime(ev.createdAt)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-zinc-100">{ev.adminDetail}</p>
                    {ev.routePath && (
                      <p className="mt-1 text-[11px] text-zinc-400 font-mono">
                        {ev.httpStatus ?? "—"} · {ev.routePath}
                      </p>
                    )}
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-zinc-500" />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={() => setSelected(null)}>
          <aside
            className="h-full w-full max-w-lg overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${(SEVERITY_STYLE[selected.severity] ?? SEVERITY_STYLE.medium).chip}`}>
                    {selected.severity}
                  </span>
                  <span className="font-mono text-xs text-zinc-200">{selected.code}</span>
                </div>
                <h3 className="mt-2 text-lg font-semibold text-zinc-50">
                  {selected.surface ? `${selected.surface} · ${selected.code}` : selected.code}
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {STATUS_LABEL[selected.status] ?? selected.status} · {formatTime(selected.createdAt)}
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <section className="mt-5 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <h4 className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">User saw</h4>
              <p className="text-sm text-zinc-100">{selected.userMessage}</p>
            </section>

            <section className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <h4 className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Admin detail</h4>
              <p className="text-sm text-zinc-100 whitespace-pre-wrap break-words">{selected.adminDetail}</p>
            </section>

            {selected.suggestedResolution && (
              <section className="mt-3 rounded-lg border border-emerald-700/40 bg-emerald-500/5 p-3">
                <h4 className="mb-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-300">
                  <BookOpen className="h-3 w-3" /> Suggested resolution
                </h4>
                <p className="text-sm text-zinc-100 whitespace-pre-wrap">{selected.suggestedResolution}</p>
              </section>
            )}

            <section className="mt-3 grid grid-cols-2 gap-3 text-xs text-zinc-400">
              {selected.routePath && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">Route</div>
                  <div className="mt-0.5 font-mono text-zinc-200">{selected.httpStatus ?? "—"} · {selected.routePath}</div>
                </div>
              )}
              {selected.requestId && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">Request ID</div>
                  <div className="mt-0.5 font-mono text-zinc-200 break-all">{selected.requestId}</div>
                </div>
              )}
            </section>

            {selected.metadata && (
              <section className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <h4 className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Metadata</h4>
                <pre className="overflow-x-auto text-[11px] text-zinc-300">
{JSON.stringify(selected.metadata, null, 2)}
                </pre>
              </section>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              {selected.status !== "acknowledged" && (
                <button
                  onClick={() => void updateStatus(selected.id, "acknowledged")}
                  className="rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20"
                >
                  Acknowledge
                </button>
              )}
              {selected.status !== "resolved" && (
                <button
                  onClick={() => void updateStatus(selected.id, "resolved")}
                  className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20"
                >
                  Mark resolved
                </button>
              )}
              {selected.status !== "wont_fix" && (
                <button
                  onClick={() => void updateStatus(selected.id, "wont_fix")}
                  className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-600"
                >
                  Won't fix
                </button>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
