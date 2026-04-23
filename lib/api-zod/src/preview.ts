import { z } from "zod";
import { EnhanceMediaBody } from "./generated/api";

export const RenderMediaPreviewBody = z.object({
  base64Data: z.string(),
  mimeType: z.string(),
  enhancementType: EnhanceMediaBody.shape.enhancementType,
  settings: z.record(z.string(), z.unknown()).optional(),
  previewMaxDimension: z.number().int().positive().max(4096).optional(),
});

export type RenderMediaPreviewBody = z.infer<typeof RenderMediaPreviewBody>;

export const RenderMediaPreviewResponse = z.object({
  base64: z.string(),
  mimeType: z.string(),
  filterId: z.string().nullish(),
  filterVersion: z.string().nullish(),
  renderKind: z.literal("preview"),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export type RenderMediaPreviewResponse = z.infer<typeof RenderMediaPreviewResponse>;
