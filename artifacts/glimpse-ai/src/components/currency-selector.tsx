import React from "react";
import {
  CURRENCY_CATALOG,
  type CurrencyCode,
} from "@/lib/currency";

interface CurrencySelectorProps {
  value: CurrencyCode;
  onChange: (code: CurrencyCode) => void;
  /** Optional label rendered before the dropdown. */
  label?: string;
}

/**
 * Compact currency picker for billing surfaces. Renders as a native <select>
 * (great for keyboard / screen-reader / mobile) with INR / USD / GBP. The
 * settlement currency is always INR — this control only changes how prices
 * are displayed.
 */
export function CurrencySelector({ value, onChange, label = "Display currency" }: CurrencySelectorProps): React.ReactElement {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-zinc-400">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as CurrencyCode)}
        className="h-7 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100 focus:outline-none focus:border-teal-500/60"
      >
        {CURRENCY_CATALOG.map((c) => (
          <option key={c.code} value={c.code}>
            {c.symbol} {c.code}
          </option>
        ))}
      </select>
    </label>
  );
}
