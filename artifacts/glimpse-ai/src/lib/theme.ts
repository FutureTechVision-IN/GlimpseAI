import { useEffect, useState, useCallback } from "react";

/**
 * Lightweight theme manager. We avoid pulling in next-themes / vite-themes
 * because we already control <html> in `main.tsx` and just need:
 *   - persistent user choice (light | dark | system)
 *   - reactive `prefers-color-scheme` follow-along when set to "system"
 *   - imperative resolve to "light" / "dark" for components that need to know
 *
 * The resolved class is toggled on `document.documentElement` (`.dark` is
 * already wired through Tailwind via `@custom-variant dark (&:is(.dark *))`).
 */

export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "glimpse_theme";
/** Custom DOM event used to keep multiple mounted `useTheme` consumers in
 *  sync within the same tab. `localStorage` only fires `storage` events in
 *  *other* tabs, so we need an in-tab broadcast as well. */
const BROADCAST_EVENT = "glimpse:theme-changed";

interface ThemeBroadcastDetail {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
}

function readStoredChoice(): ThemeChoice {
  if (typeof window === "undefined") return "dark";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // Treat private mode / restricted storage as "no preference".
  }
  return "dark"; // existing app default — keep the original look on first visit
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === "system") return systemPrefersDark() ? "dark" : "light";
  return choice;
}

export function applyThemeClass(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (resolved === "dark") el.classList.add("dark");
  else el.classList.remove("dark");
  el.style.colorScheme = resolved;
}

/** Apply persisted theme as early as possible (called from main.tsx). */
export function bootstrapTheme(): void {
  const choice = readStoredChoice();
  const resolved = resolveTheme(choice);
  applyThemeClass(resolved);
}

/** React hook for components that want to render a theme toggle. */
export function useTheme(): {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  setChoice: (c: ThemeChoice) => void;
} {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => readStoredChoice());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readStoredChoice()));

  // Persist + apply whenever the user explicitly changes the choice. Also
  // broadcast a window event so other mounted `useTheme()` consumers (e.g.
  // sidebar toggle + Settings toggle) stay in lockstep.
  const setChoice = useCallback((next: ThemeChoice): void => {
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
    setChoiceState(next);
    const r = resolveTheme(next);
    setResolved(r);
    applyThemeClass(r);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent<ThemeBroadcastDetail>(BROADCAST_EVENT, { detail: { choice: next, resolved: r } }),
      );
    }
  }, []);

  // Follow OS scheme changes only while in "system" mode.
  useEffect(() => {
    if (choice !== "system") return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => {
      const r: ResolvedTheme = mq.matches ? "dark" : "light";
      setResolved(r);
      applyThemeClass(r);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [choice]);

  // Cross-instance sync — listen for broadcasts from any other `useTheme`
  // caller (in this tab) and the `storage` event (cross-tab). When either
  // fires, mirror the choice into our local state so every toggle on the
  // page reflects the same selection.
  useEffect(() => {
    if (typeof window === "undefined") return;

    function onBroadcast(e: Event): void {
      const detail = (e as CustomEvent<ThemeBroadcastDetail>).detail;
      if (!detail) return;
      setChoiceState(detail.choice);
      setResolved(detail.resolved);
    }

    function onStorage(e: StorageEvent): void {
      if (e.key !== STORAGE_KEY) return;
      const next = readStoredChoice();
      const r = resolveTheme(next);
      setChoiceState(next);
      setResolved(r);
      applyThemeClass(r);
    }

    window.addEventListener(BROADCAST_EVENT, onBroadcast);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(BROADCAST_EVENT, onBroadcast);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return { choice, resolved, setChoice };
}
