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

const router: IRouter = Router();

const ENHANCEMENT_DURATION_MAP: Record<string, number> = {
  auto: 2000,
  portrait: 3000,
  skin: 2500,
  lighting: 2000,
  color: 1500,
  background: 4000,
  beauty: 3000,
  upscale: 5000,
  filter: 1000,
  trim: 3000,
  stabilize: 6000,
  custom: 3000,
};

function jobToResponse(j: typeof mediaJobsTable.$inferSelect) {
  return {
    id: j.id,
    userId: j.userId,
    mediaType: j.mediaType,
    status: j.status,
    filename: j.filename,
    originalUrl: j.originalUrl,
    processedUrl: j.processedUrl,
    thumbnailUrl: j.thumbnailUrl,
    enhancementType: j.enhancementType,
    presetId: j.presetId,
    errorMessage: j.errorMessage,
    processingTimeMs: j.processingTimeMs,
    fileSize: j.fileSize,
    createdAt: j.createdAt,
    completedAt: j.completedAt,
  };
}

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

router.post("/media/enhance", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = EnhanceMediaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { jobId, enhancementType, presetId } = parsed.data;

  const [job] = await db.select().from(mediaJobsTable)
    .where(and(eq(mediaJobsTable.id, jobId), eq(mediaJobsTable.userId, req.userId!)));

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const startTime = Date.now();

  await db.update(mediaJobsTable)
    .set({ status: "processing", enhancementType, presetId: presetId ?? null })
    .where(eq(mediaJobsTable.id, jobId));

  await db.update(usersTable)
    .set({ creditsUsed: sql`${usersTable.creditsUsed} + 1` })
    .where(eq(usersTable.id, req.userId!));

  const processingTime = ENHANCEMENT_DURATION_MAP[enhancementType] ?? 2000;
  const userId = req.userId!;
  setTimeout(async () => {
    const processedUrl = job.base64Data ?? null;
    await db.update(mediaJobsTable).set({
      status: "completed",
      processedUrl,
      thumbnailUrl: processedUrl,
      processingTimeMs: Date.now() - startTime,
      completedAt: new Date(),
    }).where(eq(mediaJobsTable.id, jobId));
  }, processingTime);

  const [updated] = await db.select().from(mediaJobsTable).where(eq(mediaJobsTable.id, jobId));
  res.json(jobToResponse(updated));
});

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
