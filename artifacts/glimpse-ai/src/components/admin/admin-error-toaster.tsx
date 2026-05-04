import React, { useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { useLocation } from "wouter";
import { ToastAction } from "@/components/ui/toast";

/**
 * Background poller that surfaces newly opened admin error events as
 * non-modal toast notifications. Renders nothing visible — it only lives
 * to fire `toast()` calls.
 *
 * Polling is gentle (every 45s) and only runs when:
 *  1. The user is actually an admin (no point polling for regular users)
 *  2. The page is visible (paused under `document.hidden`)
 *
 * The toast deep-links to /admin#error-events/<id> which the
 * `ErrorEventsPanel` honours via its own hashchange listener.
 */
export function AdminErrorToaster(): React.ReactElement | null {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const seenRef = useRef<{ open: number; critical: number }>({ open: 0, critical: 0 });
  const initialisedRef = useRef(false);

  useEffect(() => {
    if (user?.role !== "admin") return;

    let timer: ReturnType<typeof setInterval> | null = null;

    async function tick(): Promise<void> {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const token = window.localStorage.getItem("glimpse_token");
        if (!token) return;
        const resp = await fetch("/api/admin/notifications/summary", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) return;
        const data = (await resp.json()) as {
          openErrors: number;
          criticalOpenErrors: number;
          newFeedback: number;
        };
        const prev = seenRef.current;
        // Skip the very first tick — we don't want to spam a toast for every
        // historic open event when the admin just signed in.
        if (!initialisedRef.current) {
          initialisedRef.current = true;
          seenRef.current = { open: data.openErrors, critical: data.criticalOpenErrors };
          return;
        }
        if (data.criticalOpenErrors > prev.critical) {
          toast({
            title: "Critical error needs attention",
            description: `${data.criticalOpenErrors - prev.critical} new critical event(s). Open the admin error log to triage.`,
            variant: "destructive",
            duration: 12_000,
            action: (
              <ToastAction altText="Review" onClick={() => navigate("/admin?tab=errors")}>
                Review
              </ToastAction>
            ),
          });
        } else if (data.openErrors > prev.open) {
          toast({
            title: "New error event logged",
            description: `${data.openErrors - prev.open} new event(s) ready for triage.`,
            duration: 8_000,
            action: (
              <ToastAction altText="Open" onClick={() => navigate("/admin?tab=errors")}>
                Open
              </ToastAction>
            ),
          });
        }
        seenRef.current = { open: data.openErrors, critical: data.criticalOpenErrors };
      } catch {
        // Silent — admin toaster is best-effort, never blocks the UI.
      }
    }

    void tick();
    timer = setInterval(tick, 45_000);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [user?.role, toast, navigate]);

  return null;
}
