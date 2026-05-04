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
  let planSlug: string | null = null;
  let planMonthlyCredits: number | null = null;
  let planExpiry: string | null = null;
  if (user.planId) {
    const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, user.planId));
    if (plan) {
      planName = plan.name;
      planSlug = plan.slug;
      planMonthlyCredits = plan.creditsPerMonth;
    }
    if (user.planExpiresAt) planExpiry = user.planExpiresAt.toISOString();
  }

  const photoCountResult = await db.select({ c: count() }).from(mediaJobsTable)
    .where(and(eq(mediaJobsTable.userId, req.userId!), eq(mediaJobsTable.mediaType, "photo")));
  const videoCountResult = await db.select({ c: count() }).from(mediaJobsTable)
    .where(and(eq(mediaJobsTable.userId, req.userId!), eq(mediaJobsTable.mediaType, "video")));
  const totalResult = await db.select({ c: count() }).from(mediaJobsTable)
    .where(eq(mediaJobsTable.userId, req.userId!));

  // Trial state — `premiumTrialEndsAt` time-boxes premium capabilities.
  // The dashboard uses this to render a "Trial — N days remaining" badge
  // separate from the subscription status.
  const now = Date.now();
  const trialEndsAt = user.premiumTrialEndsAt instanceof Date ? user.premiumTrialEndsAt : null;
  const trialActive = trialEndsAt !== null && trialEndsAt.getTime() > now;
  const trialDaysRemaining = trialActive
    ? Math.max(0, Math.ceil((trialEndsAt!.getTime() - now) / (24 * 60 * 60 * 1000)))
    : 0;

  // Bonus credits from one-time credit packs. We compute this as the delta
  // between the user's current monthly cap and their plan's published cap
  // (or 0 for free users). When users buy a pack via /payments/purchase-credits
  // the route bumps `creditsLimit` by the pack's credit amount, so this delta
  // surfaces what the user effectively bought on top of their subscription.
  const bonusCredits = planMonthlyCredits !== null
    ? Math.max(0, user.creditsLimit - planMonthlyCredits)
    : Math.max(0, user.creditsLimit - 30); // 30 ≈ free tier baseline

  res.json({
    creditsUsed: user.creditsUsed,
    creditsLimit: user.creditsLimit,
    creditsRemaining: Math.max(0, user.creditsLimit - user.creditsUsed),
    dailyCreditsUsed: user.dailyCreditsUsed,
    dailyLimit: user.dailyLimit,
    dailyRemaining: Math.max(0, user.dailyLimit - user.dailyCreditsUsed),
    dailyResetAt: user.dailyResetAt instanceof Date ? user.dailyResetAt.toISOString() : null,
    planName,
    planSlug,
    planExpiry,
    planMonthlyCredits,
    bonusCredits,
    trialActive,
    trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null,
    trialDaysRemaining,
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
