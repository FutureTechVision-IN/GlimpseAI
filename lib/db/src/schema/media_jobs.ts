import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const mediaJobsTable = pgTable("media_jobs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  mediaType: text("media_type").notNull(),
  status: text("status").notNull().default("pending"),
  filename: text("filename").notNull(),
  originalUrl: text("original_url"),
  processedUrl: text("processed_url"),
  thumbnailUrl: text("thumbnail_url"),
  enhancementType: text("enhancement_type"),
  presetId: integer("preset_id"),
  errorMessage: text("error_message"),
  processingTimeMs: integer("processing_time_ms"),
  fileSize: integer("file_size").notNull().default(0),
  base64Data: text("base64_data"),
  /** Internal trace code (set when job completes): GLP-{id}-{enh}-{date}-{suffix} */
  referenceCode: text("reference_code").unique(),
  /** When ephemeral blob columns were cleared for stateless retention policy */
  mediaPurgedAt: timestamp("media_purged_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMediaJobSchema = createInsertSchema(mediaJobsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMediaJob = z.infer<typeof insertMediaJobSchema>;
export type MediaJob = typeof mediaJobsTable.$inferSelect;
