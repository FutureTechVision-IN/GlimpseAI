/**
 * Support contact details + helpers.
 *
 * Centralized so the support email is updated in one place when we move
 * from the staging address to a production support@ alias. The mailto helpers
 * pre-fill subject + body so users land in their mail client with context
 * already filled in (reduces friction on the mandatory-support flow for
 * account closure / subscription cancellation / refund-policy disputes).
 *
 * Configurable via Vite env at build time:
 *   VITE_SUPPORT_EMAIL  — defaults to glimpseai.global@gmail.com
 */

export const SUPPORT_EMAIL: string =
  (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined) ?? "glimpseai.global@gmail.com";

/**
 * Build a `mailto:` URL with subject + body URL-encoded so most mail
 * clients open the compose window with the context already in place.
 */
export function supportMailto(subject: string, body?: string): string {
  const params = new URLSearchParams();
  params.set("subject", subject);
  if (body) params.set("body", body);
  return `mailto:${SUPPORT_EMAIL}?${params.toString()}`;
}
