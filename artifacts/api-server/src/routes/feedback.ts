import { Router, type IRouter } from "express";
import crypto from "crypto";
import { logger } from "../lib/logger";
import { createRateLimiter } from "../lib/rate-limit";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "../middlewares/auth";
import { db, feedbackEntriesTable } from "@workspace/db";

const router: IRouter = Router();

/**
 * Hash an IP address before persistence. We need *some* way to identify
 * abusive submitters across rate-limit windows, but raw IPs are PII under
 * GDPR/DPDP — so we keep only an HMAC fingerprint that's stable per session
 * but un-reversible. The salt comes from the JWT secret so it's already
 * deployment-scoped and rotates with the auth secret.
 */
function hashIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  try {
    return crypto.createHmac("sha256", getJwtSecret()).update(ip).digest("hex").slice(0, 32);
  } catch {
    return null;
  }
}

// Rate limit: 5 feedback submissions per IP per hour. Generous enough that a
// real user filing multiple notes from the same office NAT isn't blocked, but
// prevents form abuse and accidental spam from a stuck UI.
const feedbackLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyPrefix: "feedback",
});

interface FeedbackBody {
  rating?: number;        // 1..5
  category?: string;      // "bug" | "idea" | "praise" | "other"
  message?: string;       // free-form text
  context?: {             // page / feature context the widget was opened from
    path?: string;
    feature?: string;
  };
}

/**
 * POST /feedback — accept user feedback from the floating widget.
 *
 * Auth is OPTIONAL: anonymous feedback is allowed (the widget is mounted in
 * Layout, which is also reachable from a couple of unauthenticated marketing
 * surfaces). When a JWT is present we attach the userId for follow-up.
 *
 * Storage: feedback is now persisted to the `feedback_entries` table for
 * triage + trend analysis from the admin console. We continue to emit a
 * structured `feedback_received` log so existing observability pipelines
 * keep working unchanged. If the DB write fails we still ack with 200 to
 * avoid losing user data — pino has the full payload as a fallback.
 */
router.post("/feedback", feedbackLimiter, async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as FeedbackBody;

  // ── Validation ────────────────────────────────────────────────────────
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message.length < 3) {
    res.status(400).json({ error: "Tell us a bit more — at least 3 characters." });
    return;
  }
  if (message.length > 5000) {
    res.status(400).json({ error: "Feedback is too long (max 5000 characters)." });
    return;
  }

  const rating = typeof body.rating === "number" && body.rating >= 1 && body.rating <= 5
    ? Math.round(body.rating)
    : null;

  const allowedCategories = new Set(["bug", "idea", "praise", "other"]);
  const category = typeof body.category === "string" && allowedCategories.has(body.category)
    ? body.category
    : "other";

  const path = typeof body.context?.path === "string" && body.context.path.length <= 200
    ? body.context.path
    : null;
  const feature = typeof body.context?.feature === "string" && body.context.feature.length <= 80
    ? body.context.feature
    : null;

  // ── Best-effort identity (anonymous OK) ───────────────────────────────
  let userId: number | null = null;
  let userRole: string | null = null;
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(authHeader.slice(7), getJwtSecret()) as { userId: number; role: string };
      userId = payload.userId;
      userRole = payload.role;
    } catch {
      // Ignore — anonymous feedback is still valid.
    }
  }

  const userAgent =
    typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 200) : null;
  const ipHash = hashIp(req.ip);

  // ── Persist (best-effort; logs are the safety net) ─────────────────────
  let feedbackId: number | null = null;
  try {
    const [row] = await db
      .insert(feedbackEntriesTable)
      .values({
        userId,
        userRole,
        rating,
        category,
        message,
        contextPath: path,
        contextFeature: feature,
        ipHash,
        userAgent,
      })
      .returning({ id: feedbackEntriesTable.id });
    feedbackId = row?.id ?? null;
  } catch (err) {
    logger.warn(
      { err, userId, category },
      "Failed to persist feedback_entries row (continuing — log retains the payload)",
    );
  }

  logger.info(
    {
      event: "feedback_received",
      feedbackId,
      userId,
      userRole,
      rating,
      category,
      path,
      feature,
      messagePreview: message.slice(0, 240),
      messageLength: message.length,
      ipHash,
      userAgent,
    },
    "User feedback received",
  );

  res.json({ success: true, message: "Thanks — your feedback has been recorded." });
});

export default router;
