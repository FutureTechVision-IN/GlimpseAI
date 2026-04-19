import { logger } from "./logger";

// =============================================================================
// API Error Formatter — User vs Admin error messaging
//
// Regular users see a friendly, generic message.
// Admins see the same message PLUS a detailed "adminInsight" with the backend
// cause so they can take corrective action.
// =============================================================================

/** Classification of API failure causes for admin diagnostics */
export type ApiFailureCause =
  | "OPENROUTER_QUOTA_EXHAUSTED"
  | "GEMINI_QUOTA_EXHAUSTED"
  | "ALL_KEYS_EXHAUSTED"
  | "KEY_INVALID"
  | "KEY_RATE_LIMITED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_ERROR"
  | "TIER_RESTRICTED"
  | "UNKNOWN";

interface ApiErrorOptions {
  /** The detected failure cause */
  cause: ApiFailureCause;
  /** Which provider failed */
  provider?: "openrouter" | "gemini" | "all";
  /** Raw error message from the provider (never shown to users) */
  rawError?: string;
  /** The user's role — determines whether admin insight is included */
  userRole?: string;
}

interface FormattedApiError {
  /** Generic user-facing message (always included) */
  error: string;
  /** Error code for frontend logic */
  code: string;
  /** Detailed admin insight (only when userRole === "admin") */
  adminInsight?: string;
}

const USER_MESSAGE = "We're experiencing temporary issues processing enhancements. Please try again in a few minutes!";
const TIER_MESSAGE = "This feature requires a premium plan. Upgrade to access enhanced AI processing.";

const ADMIN_INSIGHTS: Record<ApiFailureCause, (opts: ApiErrorOptions) => string> = {
  OPENROUTER_QUOTA_EXHAUSTED: () =>
    "Admin Insight: All OpenRouter API keys have hit their daily quota. Keys will auto-recover in ~23 hours, or add fresh keys via the admin dashboard.",
  GEMINI_QUOTA_EXHAUSTED: () =>
    "Admin Insight: The Gemini API key quota has been exhausted. Please check key rotation or add a backup key.",
  ALL_KEYS_EXHAUSTED: () =>
    "Admin Insight: Both OpenRouter and Gemini key pools are fully exhausted. Immediate action required — add new API keys or wait for daily reset.",
  KEY_INVALID: (opts) =>
    `Admin Insight: An API key for ${opts.provider ?? "unknown"} returned 401/403 (invalid or revoked). Check the admin key dashboard and rotate the key.`,
  KEY_RATE_LIMITED: (opts) =>
    `Admin Insight: ${opts.provider ?? "Provider"} returned 429 (rate limited). The key will be retried after cooldown. Consider adding more keys for this provider.`,
  PROVIDER_TIMEOUT: (opts) =>
    `Admin Insight: ${opts.provider ?? "Provider"} request timed out. This may be transient — if persistent, check provider status page.`,
  PROVIDER_ERROR: (opts) =>
    `Admin Insight: ${opts.provider ?? "Provider"} returned an unexpected error: ${(opts.rawError ?? "unknown").slice(0, 200)}`,
  TIER_RESTRICTED: () =>
    "Admin Insight: Freemium user attempted to use Gemini fallback. OpenRouter keys are exhausted — freemium users cannot fall back to Gemini.",
  UNKNOWN: (opts) =>
    `Admin Insight: Unexpected error during AI processing. Raw: ${(opts.rawError ?? "no details").slice(0, 200)}`,
};

/**
 * Format an API failure into a user-friendly response.
 * - Regular users: generic message only
 * - Admin users: generic message + detailed adminInsight
 */
export function formatApiError(opts: ApiErrorOptions): FormattedApiError {
  const isAdmin = opts.userRole === "admin";
  const isTierRestricted = opts.cause === "TIER_RESTRICTED";

  const result: FormattedApiError = {
    error: isTierRestricted ? TIER_MESSAGE : USER_MESSAGE,
    code: opts.cause,
  };

  if (isAdmin) {
    result.adminInsight = ADMIN_INSIGHTS[opts.cause](opts);
  }

  // Always log the full details server-side (never sent to non-admin users)
  logger.warn({
    cause: opts.cause,
    provider: opts.provider,
    rawError: opts.rawError?.slice(0, 300),
  }, "API failure formatted for response");

  return result;
}

/**
 * Classify a provider error into an ApiFailureCause for consistent handling.
 */
export function classifyProviderError(
  status: number | null,
  errorBody: string,
  provider: "openrouter" | "gemini",
): ApiFailureCause {
  if (status === 401 || status === 403) return "KEY_INVALID";

  if (status === 429 || errorBody.includes("RESOURCE_EXHAUSTED")) {
    const isDaily = errorBody.toLowerCase().includes("per day") ||
                    errorBody.toLowerCase().includes("daily") ||
                    errorBody.toLowerCase().includes("free-models-per-day");
    return isDaily
      ? (provider === "openrouter" ? "OPENROUTER_QUOTA_EXHAUSTED" : "GEMINI_QUOTA_EXHAUSTED")
      : "KEY_RATE_LIMITED";
  }

  if (errorBody.includes("timeout") || errorBody.includes("ETIMEDOUT") || errorBody.includes("AbortError")) {
    return "PROVIDER_TIMEOUT";
  }

  return "PROVIDER_ERROR";
}
