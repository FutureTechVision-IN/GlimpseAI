import { pgTable, text, serial, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Structured persistence for user feedback submitted via the floating widget.
 *
 * Why a dedicated table (vs the prior "log-only" stance):
 *  - Logs lose context after retention windows; a structured table lets us
 *    trend categories over time, run cohort analysis, and surface a
 *    triage queue inside the admin console.
 *  - Joining feedback ↔ users ↔ media_jobs is impossible at scale from logs.
 *  - Triage state (status / resolutionNote) needs persistent ownership.
 */
export const feedbackEntriesTable = pgTable(
  "feedback_entries",
  {
    id: serial("id").primaryKey(),

    // Identity (anonymous OK — userId is nullable)
    userId: integer("user_id"),
    userRole: text("user_role"),

    // Submission
    rating: integer("rating"),                                  // 1..5 or null
    category: text("category").notNull().default("other"),      // bug | idea | praise | other
    message: text("message").notNull(),                         // raw text (≤5000 chars)
    contextPath: text("context_path"),                          // /editor?mode=batch
    contextFeature: text("context_feature"),                    // page / surface label

    // Forensics — small, redacted, used to triage abuse and reproduce
    ipHash: text("ip_hash"),                                    // sha256 of remote IP, never raw
    userAgent: text("user_agent"),

    // Triage workflow
    status: text("status").notNull().default("new"),            // new | reviewing | actioned | dismissed
    assigneeId: integer("assignee_id"),                         // admin user id, nullable
    resolutionNote: text("resolution_note"),                    // internal-only

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    statusCreatedIdx: index("feedback_entries_status_created_idx").on(t.status, t.createdAt),
    categoryCreatedIdx: index("feedback_entries_category_created_idx").on(t.category, t.createdAt),
  }),
);

export const insertFeedbackEntrySchema = createInsertSchema(feedbackEntriesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFeedbackEntry = z.infer<typeof insertFeedbackEntrySchema>;
export type FeedbackEntry = typeof feedbackEntriesTable.$inferSelect;

/**
 * Structured persistence for admin-actionable errors.
 *
 * The flow this enables:
 *  1. A backend route catches a failure → calls `recordErrorEvent({...})`
 *  2. The user receives a friendly `userMessage` (handled by error-envelope).
 *  3. An admin's dashboard polls `GET /admin/error-events?status=open`
 *     and renders a non-modal toast linking to the row's detail panel.
 *  4. Admin opens the detail panel → root cause + suggested resolution
 *     are visible → marks `status` as `acknowledged` or `resolved`.
 *
 * Severity mapping:
 *  - critical = revenue or auth blocked (payment outages, login broken)
 *  - high     = feature broken for many users (e.g., enhance pipeline 5xx)
 *  - medium   = degraded experience, single feature
 *  - low      = recoverable / informational
 */
export const errorEventsTable = pgTable(
  "error_events",
  {
    id: serial("id").primaryKey(),

    // Stable error identifier (e.g., "PAYMENT_GATEWAY_UNAVAILABLE")
    code: text("code").notNull(),

    // What the user (and what an admin) saw
    userMessage: text("user_message").notNull(),
    adminDetail: text("admin_detail").notNull(),

    // Triage hints captured at the call site
    severity: text("severity").notNull().default("medium"),   // critical | high | medium | low
    surface: text("surface"),                                 // billing | media | auth | provider-keys | …
    runbookHref: text("runbook_href"),                        // /admin/error-events/:id by default

    // Context
    userId: integer("user_id"),
    routePath: text("route_path"),                            // /api/payments/purchase-credits
    httpStatus: integer("http_status"),
    requestId: text("request_id"),                            // correlation id for log lookup

    // Suggested next step rendered to admin (rule-of-thumb fixes)
    suggestedResolution: text("suggested_resolution"),

    // Free-form structured data (truncated stack, keyId, etc.) — NEVER raw secrets
    metadata: jsonb("metadata"),

    // Triage workflow
    status: text("status").notNull().default("open"),         // open | acknowledged | resolved | wont_fix
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    acknowledgedBy: integer("acknowledged_by"),               // admin user id

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    statusSeverityIdx: index("error_events_status_severity_idx").on(t.status, t.severity, t.createdAt),
    codeCreatedIdx: index("error_events_code_created_idx").on(t.code, t.createdAt),
  }),
);

export const insertErrorEventSchema = createInsertSchema(errorEventsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertErrorEvent = z.infer<typeof insertErrorEventSchema>;
export type ErrorEvent = typeof errorEventsTable.$inferSelect;
