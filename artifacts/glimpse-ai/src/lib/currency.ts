/**
 * Multi-currency display helper.
 *
 * Settlement currency is INR (Razorpay's primary corridor). This helper
 * converts an INR amount to a chosen display currency for users who prefer
 * to see prices in USD or GBP, while the actual charge still happens in INR.
 *
 * IMPORTANT: this is DISPLAY-ONLY conversion, not a billing FX. The user's
 * card issuer / Razorpay handles real currency conversion at checkout time.
 * We surface this caveat in the UI so users aren't surprised by their bank's
 * exchange rate.
 *
 * Rates are intentionally rounded conservatively (slightly favoring the
 * settlement currency) so users don't see "₹999 ≈ $11.42" on the marketing
 * page and then get charged the equivalent of $11.65 by their bank.
 *
 * Rate refresh strategy: rates can be overridden via `VITE_FX_USD_PER_INR`
 * etc. at build time without a code change. For real production we'd swap
 * this for a daily fetch from the Razorpay FX API or a rate provider.
 */

export type CurrencyCode = "INR" | "USD" | "GBP";

export interface CurrencyMeta {
  code: CurrencyCode;
  symbol: string;
  label: string;
  /** Locale used for formatting via Intl.NumberFormat. */
  locale: string;
  /** How many INR equal 1 unit of this currency (i.e. 1 USD ≈ 85 INR). */
  inrPerUnit: number;
}

const ENV_USD_PER_INR = Number(import.meta.env.VITE_FX_USD_PER_INR ?? "");
const ENV_GBP_PER_INR = Number(import.meta.env.VITE_FX_GBP_PER_INR ?? "");

/**
 * Catalog of supported display currencies.
 * INR rate is identity (1 INR = 1 INR).
 */
export const CURRENCY_CATALOG: ReadonlyArray<CurrencyMeta> = [
  { code: "INR", symbol: "₹", label: "Indian Rupee",     locale: "en-IN", inrPerUnit: 1 },
  { code: "USD", symbol: "$", label: "US Dollar",        locale: "en-US",
    inrPerUnit: Number.isFinite(ENV_USD_PER_INR) && ENV_USD_PER_INR > 0 ? ENV_USD_PER_INR : 85 },
  { code: "GBP", symbol: "£", label: "British Pound",    locale: "en-GB",
    inrPerUnit: Number.isFinite(ENV_GBP_PER_INR) && ENV_GBP_PER_INR > 0 ? ENV_GBP_PER_INR : 108 },
];

const STORAGE_KEY = "glimpse:display-currency";

export function getCurrencyMeta(code: CurrencyCode): CurrencyMeta {
  return CURRENCY_CATALOG.find((c) => c.code === code) ?? CURRENCY_CATALOG[0];
}

/** Read the user's preferred display currency from localStorage (or "INR"). */
export function readPreferredCurrency(): CurrencyCode {
  if (typeof window === "undefined") return "INR";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "INR" || stored === "USD" || stored === "GBP") return stored;
  return "INR";
}

/** Persist the user's preferred display currency. */
export function writePreferredCurrency(code: CurrencyCode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, code);
}

/**
 * Format an INR amount as a string in the chosen display currency.
 * If display === "INR", returns the canonical INR formatting.
 */
export function formatInDisplay(inrAmount: number, display: CurrencyCode): string {
  const meta = getCurrencyMeta(display);
  const value = inrAmount / meta.inrPerUnit;
  // Maximum fractional digits: 0 for INR (no paise displayed), 2 for USD/GBP.
  const fractionDigits = display === "INR" ? 0 : 2;
  return new Intl.NumberFormat(meta.locale, {
    style: "currency",
    currency: meta.code,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/**
 * Build a "₹999 ≈ $11.75" style label for marketing surfaces where we want
 * to show both the canonical settlement amount AND the user's preferred
 * display currency. When display === "INR" only the canonical value is shown.
 */
export function formatWithDisplayHint(inrAmount: number, display: CurrencyCode): string {
  const inrLabel = formatInDisplay(inrAmount, "INR");
  if (display === "INR") return inrLabel;
  const displayLabel = formatInDisplay(inrAmount, display);
  return `${inrLabel} ≈ ${displayLabel}`;
}
