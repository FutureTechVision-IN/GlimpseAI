/**
 * Client helpers for the structured API error envelope produced by
 * `artifacts/api-server/src/lib/error-envelope.ts`.
 *
 * Two consumers, one source of truth:
 *  - End users see only `userMessage` (or a generic copy if the server didn't
 *    populate one) — never raw stack traces or backend jargon.
 *  - Admins see `adminDetail`, `runbookHref`, and `suggestedResolution` and
 *    can deep-link straight to the dedicated admin error-events panel.
 */

export type ErrorSeverity = "critical" | "high" | "medium" | "low";

export interface ApiErrorEnvelope {
  code: string;
  userMessage: string;
  message?: string;
  severity: ErrorSeverity;
  surface: string | null;
  runbookHref: string | null;
  requestId: string | null;
  adminDetail: string;
  suggestedResolution: string | null;
}

export class ApiError extends Error {
  /** HTTP status from the response. */
  status: number;
  /** Parsed envelope when present; null when the server didn't follow the contract. */
  envelope: ApiErrorEnvelope | null;
  /** Falls back to the legacy `{error: string}` shape from older endpoints. */
  legacy: string | null;

  constructor(status: number, envelope: ApiErrorEnvelope | null, legacy: string | null) {
    super(envelope?.userMessage ?? envelope?.message ?? legacy ?? `Request failed (${status})`);
    this.status = status;
    this.envelope = envelope;
    this.legacy = legacy;
  }

  /**
   * Friendly message safe to render to end users — never leaks the
   * `adminDetail` field.
   */
  get userMessage(): string {
    if (this.envelope?.userMessage) return this.envelope.userMessage;
    if (this.legacy) {
      // Legacy strings sometimes contain technical guidance — fall back to a
      // generic line for 5xx so we don't leak internals to end users.
      if (this.status >= 500) {
        return "Something went wrong on our side. Please try again in a moment.";
      }
      return this.legacy;
    }
    return this.status >= 500
      ? "Something went wrong on our side. Please try again in a moment."
      : "We couldn't process that request. Please double-check and retry.";
  }
}

/** Parse a fetch Response into a typed ApiError. Always resolves. */
export async function readApiError(resp: Response): Promise<ApiError> {
  let parsed: unknown = null;
  try {
    parsed = await resp.json();
  } catch {
    // Non-JSON body — that's OK, fall through.
  }
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const errorObj = obj.error;

  if (errorObj && typeof errorObj === "object") {
    const e = errorObj as Record<string, unknown>;
    const env: ApiErrorEnvelope = {
      code: typeof e.code === "string" ? e.code : "UNKNOWN_ERROR",
      userMessage:
        typeof e.userMessage === "string"
          ? e.userMessage
          : typeof e.message === "string"
            ? e.message
            : "We couldn't complete that request.",
      message: typeof e.message === "string" ? e.message : undefined,
      severity:
        e.severity === "critical" || e.severity === "high" || e.severity === "medium" || e.severity === "low"
          ? e.severity
          : "medium",
      surface: typeof e.surface === "string" ? e.surface : null,
      runbookHref: typeof e.runbookHref === "string" ? e.runbookHref : null,
      requestId: typeof e.requestId === "string" ? e.requestId : null,
      adminDetail: typeof e.adminDetail === "string" ? e.adminDetail : "",
      suggestedResolution: typeof e.suggestedResolution === "string" ? e.suggestedResolution : null,
    };
    return new ApiError(resp.status, env, null);
  }

  if (typeof errorObj === "string") {
    return new ApiError(resp.status, null, errorObj);
  }
  return new ApiError(resp.status, null, null);
}
