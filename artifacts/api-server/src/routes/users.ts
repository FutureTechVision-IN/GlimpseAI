import { Router, IRouter } from "express";
import { db, usersTable, mediaJobsTable, plansTable } from "@workspace/db";
import { eq, and, count, desc } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { UpdateProfileBody, GetUserHistoryQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.patch("/users/profile", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = UpdateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [user] = await db.update(usersTable)
    .set(parsed.data)
    .where(eq(usersTable.id, req.userId!))
    .returning();

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    planId: user.planId,
    creditsUsed: user.creditsUsed,
    creditsLimit: user.creditsLimit,
    isSuspended: user.isSuspended,
    createdAt: user.createdAt,
  });
});

router.get("/users/usage", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  let planName: string | null = null;
  let planExpiry: string | null = null;
  if (user.planId) {
    const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, user.planId));
    if (plan) planName = plan.name;
    if (user.planExpiresAt) planExpiry = user.planExpiresAt.toISOString();
  }

  const photoCountResult = await db.select({ c: count() }).from(mediaJobsTable)
    .where(and(eq(mediaJobsTable.userId, req.userId!), eq(mediaJobsTable.mediaType, "photo")));
  const videoCountResult = await db.select({ c: count() }).from(mediaJobsTable)
    .where(and(eq(mediaJobsTable.userId, req.userId!), eq(mediaJobsTable.mediaType, "video")));
  const totalResult = await db.select({ c: count() }).from(mediaJobsTable)
    .where(eq(mediaJobsTable.userId, req.userId!));

  res.json({
    creditsUsed: user.creditsUsed,
    creditsLimit: user.creditsLimit,
    creditsRemaining: Math.max(0, user.creditsLimit - user.creditsUsed),
    dailyCreditsUsed: user.dailyCreditsUsed,
    dailyLimit: user.dailyLimit,
    dailyRemaining: Math.max(0, user.dailyLimit - user.dailyCreditsUsed),
    planName,
    planExpiry,
    photoCount: photoCountResult[0]?.c ?? 0,
    videoCount: videoCountResult[0]?.c ?? 0,
    totalJobs: totalResult[0]?.c ?? 0,
  });
});

router.get("/users/history", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const params = GetUserHistoryQueryParams.safeParse(req.query);
  const page = params.success ? (params.data.page ?? 1) : 1;
  const limit = params.success ? (params.data.limit ?? 20) : 20;
  const type = params.success ? (params.data.type ?? "all") : "all";

  const offset = (page - 1) * limit;

  let query = db.select().from(mediaJobsTable).where(eq(mediaJobsTable.userId, req.userId!));
  if (type !== "all") {
    query = db.select().from(mediaJobsTable)
      .where(and(eq(mediaJobsTable.userId, req.userId!), eq(mediaJobsTable.mediaType, type)));
  }

  const jobs = await db.select().from(mediaJobsTable)
    .where(eq(mediaJobsTable.userId, req.userId!))
    .orderBy(desc(mediaJobsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const totalResult = await db.select({ c: count() }).from(mediaJobsTable)
    .where(eq(mediaJobsTable.userId, req.userId!));
  const total = totalResult[0]?.c ?? 0;

  res.json({
    items: jobs.map(j => ({
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
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
});

router.delete("/users/delete-account", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  await db.delete(usersTable).where(eq(usersTable.id, req.userId!));
  res.json({ success: true, message: "Account deleted" });
});

export default router;
