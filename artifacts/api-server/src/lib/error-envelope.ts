/**
 * Centralised error response envelope.
 *
 * Two audiences, one transport:
 *   - End-user UI: reads `userMessage` only — friendly, non-technical, never
 *     leaks stack traces, vendor names, or raw error text.
 *   - Admin UI:    reads `adminDetail`, `code`, `surface`, `runbookHref`,
 *     `severity`, `suggestedResolution` to render an actionable notification.
 *
 * The same JSON body powers both because the admin client identifies itself
 * via the JWT role on subsequent /admin/error-events calls — we don't
 * branch the response on the request, which keeps caching and rate-limiting
 * predictable.
 *
 * SECURITY: never include raw exception messages, key prefixes/secrets, IPs,
 * or PII in `userMessage` or `adminDetail`. Put redacted forensics in
 * `metadata` only — that field is admin-only and never surfaced to users.
 */

import type { Response, Request } from "express";
import { db, errorEventsTable } from "@workspace/db";
import { logger } from "./logger";

export type ErrorSeverity = "critical" | "high" | "medium" | "low";

export interface ErrorEnvelopeInput {
  /** Stable machine-readable code (UPPER_SNAKE). e.g., PAYMENT_GATEWAY_UNAVAILABLE */
  code: string;
  /** HTTP status to return. */
  httpStatus: number;
  /** Friendly, non-technical message rendered to end users. */
  userMessage: string;
  /** Detailed actionable text rendered to admins inside the dashboard. */
  adminDetail: string;
  /** Triage hint for ranking the admin notification feed. */
  severity?: ErrorSeverity;
  /** High-level surface (billing | media | auth | provider-keys | feedback | …). */
  surface?: string;
  /** What an admin should try next. */
  suggestedResolution?: string;
  /** Redacted JSON metadata. NEVER raw secrets / PII. */
  metadata?: Record<string, unknown>;
  /** Optional correlation id; defaults to req.id when present. */
  requestId?: string;
}

export interface ErrorEnvelopeBody {
  error: {
    code: string;
    message: string;          // alias of userMessage for legacy clients
    userMessage: string;
    severity: ErrorSeverity;
    surface: string | null;
    runbookHref: string | null;
    requestId: string | null;
    /** adminDetail is sent over the wire so admins can see it on the spot;
     *  end-user UI ignores this field by contract. */
    adminDetail: string;
    suggestedResolution: string | null;
  };
}

/**
 * Persist an admin-actionable error (best-effort) and write the envelope
 * response. Always returns; never throws — DB failures are logged and the
 * HTTP response is still delivered so the user sees the friendly message.
 */
export async function sendErrorEnvelope(
  req: Request,
  res: Response,
  input: ErrorEnvelopeInput,
): Promise<void> {
  const severity: ErrorSeverity = input.severity ?? (input.httpStatus >= 500 ? "high" : "medium");
  const surface = input.surface ?? null;
  const requestId =
    input.requestId ??
    (typeof (req as { id?: unknown }).id === "string" ? (req as { id?: string }).id ?? null : null);

  const userId =
    typeof (req as { user?: { userId?: unknown } }).user?.userId === "number"
      ? ((req as { user?: { userId?: number } }).user!.userId as number)
      : null;

  const routePath = req.originalUrl?.split("?")[0]?.slice(0, 200) ?? null;

  // 1) Best-effort persistence — admin notification feed driver.
  let eventId: number | null = null;
  try {
    const [row] = await db
      .insert(errorEventsTable)
      .values({
        code: input.code,
        userMessage: input.userMessage,
        adminDetail: input.adminDetail,
        severity,
        surface,
        userId,
        routePath,
        httpStatus: input.httpStatus,
        requestId,
        suggestedResolution: input.suggestedResolution ?? null,
        metadata: input.metadata ?? null,
      })
      .returning({ id: errorEventsTable.id });
    eventId = row?.id ?? null;
  } catch (err) {
    logger.warn(
      { err, code: input.code, surface },
      "Failed to persist error_event row (continuing with response)",
    );
  }

  // 2) Logger — keeps the same pino-friendly shape as the rest of the stack.
  logger.error(
    {
      event: "error_event",
      eventId,
      code: input.code,
      severity,
      surface,
      userId,
      routePath,
      httpStatus: input.httpStatus,
      requestId,
      adminDetail: input.adminDetail,
    },
    `error_event ${input.code}`,
  );

  // 3) Envelope response.
  const runbookHref = eventId ? `/admin/error-events/${eventId}` : null;

  const body: ErrorEnvelopeBody = {
    error: {
      code: input.code,
      message: input.userMessage,
      userMessage: input.userMessage,
      severity,
      surface,
      runbookHref,
      requestId,
      adminDetail: input.adminDetail,
      suggestedResolution: input.suggestedResolution ?? null,
    },
  };

  res.status(input.httpStatus).json(body);
}

/**
 * Pre-baked friendly messages for the most common customer-facing failures.
 * Routes pick the matching key and pass it to `sendErrorEnvelope`. This keeps
 * voice & tone consistent across the API.
 */
export const FRIENDLY: Record<string, { code: string; userMessage: string; severity: ErrorSeverity; surface: string }> = {
  PAYMENT_GATEWAY_UNAVAILABLE: {
    code: "PAYMENT_GATEWAY_UNAVAILABLE",
    userMessage:
      "We're enhancing the payment system right now — please check back shortly. Your account is unaffected.",
    severity: "critical",
    surface: "billing",
  },
  PAYMENT_VERIFY_FAILED: {
    code: "PAYMENT_VERIFY_FAILED",
    userMessage:
      "We couldn't confirm that payment with your provider. If your card was charged, our team will reconcile it within a few minutes — please reach out if you need help.",
    severity: "high",
    surface: "billing",
  },
  PROVIDER_QUOTA_EXHAUSTED: {
    code: "PROVIDER_QUOTA_EXHAUSTED",
    userMessage:
      "Our AI service is briefly at capacity. Please retry in a moment — we route to a backup automatically.",
    severity: "high",
    surface: "media",
  },
  ENHANCEMENT_FAILED: {
    code: "ENHANCEMENT_FAILED",
    userMessage:
      "We couldn't finish that enhancement. Please try again — if it keeps happening, switch to a different photo and let us know.",
    severity: "medium",
    surface: "media",
  },
  RATE_LIMITED: {
    code: "RATE_LIMITED",
    userMessage:
      "You've reached the request limit for this short window. Please slow down a touch and retry shortly.",
    severity: "low",
    surface: "throttle",
  },
};
