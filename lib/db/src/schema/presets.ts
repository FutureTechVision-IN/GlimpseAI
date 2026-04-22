import { pgTable, text, serial, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const presetsTable = pgTable("presets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  mediaType: text("media_type").notNull(),
  category: text("category").notNull(),
  isPremium: boolean("is_premium").notNull().default(false),
  thumbnailUrl: text("thumbnail_url"),
  settings: jsonb("settings"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPresetSchema = createInsertSchema(presetsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPreset = z.infer<typeof insertPresetSchema>;
export type Preset = typeof presetsTable.$inferSelect;
