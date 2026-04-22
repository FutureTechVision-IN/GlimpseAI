export function formatMoney(amount: number, currency: string): string {
  const normalized = currency.toUpperCase();
  const locale = normalized === "INR" ? "en-IN" : "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: normalized,
    maximumFractionDigits: normalized === "INR" ? 0 : 2,
  }).format(amount);
}
