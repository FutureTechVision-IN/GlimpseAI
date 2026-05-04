import React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeChoice } from "@/lib/theme";

/**
 * Three-way segmented control: Light / Dark / System.
 *
 * Designed to slot into Settings cards or the layout header; the variant
 * prop controls visual density without duplicating the underlying state
 * machinery.
 */
export function ThemeToggle({ variant = "default" }: { variant?: "default" | "compact" }): React.ReactElement {
  const { choice, setChoice } = useTheme();

  const options: { id: ThemeChoice; label: string; Icon: React.ElementType }[] = [
    { id: "light",  label: "Light",  Icon: Sun },
    { id: "dark",   label: "Dark",   Icon: Moon },
    { id: "system", label: "System", Icon: Monitor },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={
        "inline-flex items-center rounded-full border border-zinc-300 bg-white p-1 shadow-sm " +
        "dark:border-zinc-700 dark:bg-zinc-900"
      }
    >
      {options.map(({ id, label, Icon }) => {
        const active = choice === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setChoice(id)}
            className={
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors " +
              (active
                ? "bg-teal-500 text-white shadow-sm"
                : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800")
            }
          >
            <Icon className={"h-3.5 w-3.5 " + (variant === "compact" ? "" : "")} />
            {variant === "compact" ? null : <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
