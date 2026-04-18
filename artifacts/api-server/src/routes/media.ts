import { Router, IRouter } from "express";
import { db, mediaJobsTable, usersTable, presetsTable } from "@workspace/db";
import { eq, and, desc, count } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import {
  UploadMediaBody,
  EnhanceMediaBody,
  ListMediaJobsQueryParams,
  ListPresetsQueryParams,
} from "@workspace/api-zod";
import { enhanceImage } from "../lib/image-enhancer";
import { aiProvider } from "../lib/ai-provider";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * Convert a job row into a safe API response.
 * processedUrl and thumbnailUrl are stored as raw base64 in DB.
 * We prefix them with the data URI header so <img src=> works directly.
 */
function jobToResponse(j: typeof mediaJobsTable.$inferSelect) {
  // Detect mime type from base64 header or default to jpeg
  const guessMime = (b64: string | null): string => {
    if (!b64) return "image/jpeg";
    if (b64.startsWith("data:")) return "image/jpeg"; // already prefixed (shouldn't happen)
    if (b64.startsWith("/9j/")) return "image/jpeg";
    if (b64.startsWith("iVBOR")) return "image/png";
    if (b64.startsWith("R0lGO")) return "image/gif";
    if (b64.startsWith("UklGR")) return "image/webp";
    return "image/jpeg";
  };

  const toDataUri = (b64: string | null): string | null => {
    if (!b64) return null;
    if (b64.startsWith("data:")) return b64; // already a data URI
    return `data:${guessMime(b64)};base64,${b64}`;
  };

  return {
    id: j.id,
    userId: j.userId,
    mediaType: j.mediaType,
    status: j.status,
    filename: j.filename,
    originalUrl: toDataUri(j.base64Data) ?? j.originalUrl,
    processedUrl: toDataUri(j.processedUrl),
    thumbnailUrl: toDataUri(j.thumbnailUrl),
    enhancementType: j.enhancementType,
    presetId: j.presetId,
    errorMessage: j.errorMessage,
    processingTimeMs: j.processingTimeMs,
    fileSize: j.fileSize,
    createdAt: j.createdAt,
    completedAt: j.completedAt,
  };
}

// ─── Upload ───────────────────────────────────────────────────
router.post("/media/upload", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = UploadMediaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (user.creditsUsed >= user.creditsLimit) {
    res.status(403).json({ error: "Free quota exceeded. Please upgrade to continue." });
    return;
  }

  const { filename, mimeType, size, mediaType, base64Data } = parsed.data;
  const [job] = await db.insert(mediaJobsTable).values({
    userId: req.userId!,
    mediaType,
    status: "pending",
    filename,
    fileSize: size,
    base64Data,
  }).returning();

  res.status(201).json(jobToResponse(job));
});

// ─── Enhance (REAL processing with sharp) ─────────────────────
router.post("/media/enhance", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = EnhanceMediaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { jobId, enhancementType, presetId, settings } = parsed.data;

  const [job] = await db.select().from(mediaJobsTable)
    .where(and(eq(mediaJobsTable.id, jobId), eq(mediaJobsTable.userId, req.userId!)));

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (!job.base64Data) {
    res.status(400).json({ error: "No image data available for this job" });
    return;
  }

  const startTime = Date.now();

  // Mark processing
  await db.update(mediaJobsTable)
    .set({ status: "processing", enhancementType, presetId: presetId ?? null })
    .where(eq(mediaJobsTable.id, jobId));

  // Debit credit
  await db.update(usersTable)
    .set({ creditsUsed: sql`${usersTable.creditsUsed} + 1` })
    .where(eq(usersTable.id, req.userId!));

  // Respond immediately with "processing" status
  const [processing] = await db.select().from(mediaJobsTable).where(eq(mediaJobsTable.id, jobId));
  res.json(jobToResponse(processing));

  // ── Background: real image enhancement ──
  try {
    // Detect mime type for sharp
    const rawB64 = job.base64Data;
    let mimeType = "image/jpeg";
    if (rawB64.startsWith("iVBOR")) mimeType = "image/png";
    else if (rawB64.startsWith("UklGR")) mimeType = "image/webp";

    const result = await enhanceImage(rawB64, mimeType, {
      enhancementType,
      settings: settings as Record<string, unknown> | undefined,
    });

    // Store raw base64 in DB (no prefix — jobToResponse adds it)
    await db.update(mediaJobsTable).set({
      status: "completed",
      processedUrl: result.base64,
      thumbnailUrl: result.base64,
      processingTimeMs: Date.now() - startTime,
      completedAt: new Date(),
    }).where(eq(mediaJobsTable.id, jobId));

    logger.info({ jobId, type: enhancementType, ms: Date.now() - startTime }, "Enhancement completed");
  } catch (err) {
// ─── Analyze (AI suggestion) ──────────────────────────────────
router.post("/media/analyze", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { jobId } = req.body;
  if (!jobId || typeof jobId !== "number") {
    res.status(400).json({ error: "jobId (number) is required" });
    return;
  }

  const [job] = await db.select().from(mediaJobsTable)
    .where(and(eq(mediaJobsTable.id, jobId), eq(mediaJobsTable.userId, req.userId!)));

  if (!job || !job.base64Data) {
    res.status(404).json({ error: "Job not found or no image data" });
    return;
  }

  const mimeType = job.base64Data.startsWith("iVBOR") ? "image/png"
    : job.base64Data.startsWith("UklGR") ? "image/webp" : "image/jpeg";

  try {
    const result = await aiProvider.analyzeImage(job.base64Data, mimeType);
    if (result) {
      res.json(result);
      return;
    }
  } catch (err) {
    logger.warn({ err }, "AI analysis failed, returning defaults");
  }

  res.json({
    description: "Unable to analyze image with AI",
    suggestedEnhancement: "auto",
    suggestedFilter: null,
    detectedSubjects: [],
    confidence: 0.3,
  });
});

// ─── List jobs ────────────────────────────────────────────────
router.get("/media/jobs", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const params = ListMediaJobsQueryParams.safeParse(req.query);
  const status = params.success ? params.data.status : undefined;

  let jobs;
  if (status && status !== "all") {
    jobs = await db.select().from(mediaJobsTable)
      .where(and(eq(mediaJobsTable.userId, req.userId!), eq(mediaJobsTable.status, status)))
      .orderBy(desc(mediaJobsTable.createdAt));
  } else {
    jobs = await db.select().from(mediaJobsTable)
      .where(eq(mediaJobsTable.userId, req.userId!))
      .orderBy(desc(mediaJobsTable.createdAt));
  }

  res.json(jobs.map(jobToResponse));
});

// ─── Get single job ───────────────────────────────────────────
router.get("/media/jobs/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }

  const [job] = await db.select().from(mediaJobsTable)
    .where(and(eq(mediaJobsTable.id, id), eq(mediaJobsTable.userId, req.userId!)));

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.json(jobToResponse(job));
});

// ─── Presets ──────────────────────────────────────────────────
router.get("/media/presets", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const params = ListPresetsQueryParams.safeParse(req.query);
  const type = params.success ? params.data.type : undefined;

  const presets = await db.select().from(presetsTable);
  const filtered = type && type !== "all"
    ? presets.filter(p => p.mediaType === type || p.mediaType === "both")
    : presets;

  res.json(filtered.map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    mediaType: p.mediaType,
    category: p.category,
    isPremium: p.isPremium,
    thumbnailUrl: p.thumbnailUrl,
    settings: p.settings,
  })));
});

// ─── Stats ────────────────────────────────────────────────────
router.get("/media/stats", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const allJobs = await db.select().from(mediaJobsTable)
    .where(eq(mediaJobsTable.userId, req.userId!))
    .orderBy(desc(mediaJobsTable.createdAt));

  const completed = allJobs.filter(j => j.status === "completed");
  const photos = completed.filter(j => j.mediaType === "photo");
  const videos = completed.filter(j => j.mediaType === "video");

  const avgTime = completed.length > 0
    ? Math.round(completed.reduce((s, j) => s + (j.processingTimeMs ?? 0), 0) / completed.length)
    : 0;

  const typeCounts: Record<string, number> = {};
  for (const j of completed) {
    if (j.enhancementType) {
      typeCounts[j.enhancementType] = (typeCounts[j.enhancementType] ?? 0) + 1;
    }
  }
  const topTypes = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, c]) => ({ type, count: c }));

  res.json({
    totalEnhanced: completed.length,
    photosEnhanced: photos.length,
    videosEnhanced: videos.length,
    avgProcessingTimeMs: avgTime,
    topEnhancementTypes: topTypes,
    recentActivity: allJobs.slice(0, 5).map(jobToResponse),
  });
});

export default router;
