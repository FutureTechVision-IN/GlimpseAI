import { pgTable, text, serial, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Tracks individual API key registrations.
 * Keys are stored here (encrypted/masked) with their provider, model, tier, and status.
 */
export const apiKeysTable = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(), // "openrouter" | "gemini"
  model: text("model").notNull(), // "stepfun/step-3.5-flash:free" or "gemini-2.0-flash"
  keyHash: text("key_hash").notNull(), // last 8 chars for identification (never full key)
  keyPrefix: text("key_prefix").notNull(), // first 12 chars for display
  tier: text("tier").notNull().default("free"), // "free" | "premium"
  status: text("status").notNull().default("active"), // "active" | "inactive" | "degraded" | "validating"
  priority: integer("priority").notNull().default(1),
  totalCalls: integer("total_calls").notNull().default(0),
  totalErrors: integer("total_errors").notNull().default(0),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
  lastError: text("last_error"),
  latencyMs: integer("latency_ms"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertApiKeySchema = createInsertSchema(apiKeysTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type ApiKey = typeof apiKeysTable.$inferSelect;

/**
 * Tracks daily usage per API key — aggregated stats.
 */
export const apiKeyDailyUsageTable = pgTable("api_key_daily_usage", {
  id: serial("id").primaryKey(),
  apiKeyId: integer("api_key_id").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  callCount: integer("call_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  avgLatencyMs: integer("avg_latency_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertApiKeyDailyUsageSchema = createInsertSchema(apiKeyDailyUsageTable).omit({ id: true, createdAt: true });
export type InsertApiKeyDailyUsage = z.infer<typeof insertApiKeyDailyUsageSchema>;
export type ApiKeyDailyUsage = typeof apiKeyDailyUsageTable.$inferSelect;

/**
 * Tracks per-user enhancement activity for analytics.
 */
export const enhancementLogsTable = pgTable("enhancement_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  jobId: integer("job_id").notNull(),
  enhancementType: text("enhancement_type").notNull(),
  mediaType: text("media_type").notNull(), // "photo" | "video"
  fileSize: integer("file_size").notNull().default(0),
  fileFormat: text("file_format"), // "jpeg", "png", "webp", etc.
  resolution: text("resolution"), // "1920x1080"
  processingTimeMs: integer("processing_time_ms"),
  apiKeyId: integer("api_key_id"), // which key was used for AI analysis
  provider: text("provider"), // "openrouter" | "gemini" | "local"
  metadata: jsonb("metadata"), // extra info (settings, detected subjects, etc.)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEnhancementLogSchema = createInsertSchema(enhancementLogsTable).omit({ id: true, createdAt: true });
export type InsertEnhancementLog = z.infer<typeof insertEnhancementLogSchema>;
export type EnhancementLog = typeof enhancementLogsTable.$inferSelect;
