import { Router, IRouter } from "express";
import { db, usersTable, mediaJobsTable, paymentsTable, plansTable, providersTable } from "@workspace/db";
import { eq, desc, count, sum, and, ilike, sql } from "drizzle-orm";
import { requireAuth, requireAdmin, AuthRequest } from "../middlewares/auth";
import {
  SuspendUserBody,
  SuspendUserParams,
  AdjustUserCreditsBody,
  AdjustUserCreditsParams,
  ListAdminUsersQueryParams,
  ListAdminJobsQueryParams,
  ListAdminPaymentsQueryParams,
  CreatePlanBody,
  UpdatePlanBody,
  CreateProviderBody,
  UpdateProviderBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/admin/stats", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  const [userStats] = await db.select({
    total: count(),
  }).from(usersTable);

  const paidUsersResult = await db.select({ c: count() }).from(usersTable)
    .where(sql`${usersTable.planId} IS NOT NULL`);

  const revenueResult = await db.select({ total: sum(paymentsTable.amount) }).from(paymentsTable)
    .where(eq(paymentsTable.status, "success"));

  const subscriptionsResult = await db.select({ c: count() }).from(usersTable)
    .where(sql`${usersTable.planExpiresAt} > NOW()`);

  const photoCountResult = await db.select({ c: count() }).from(mediaJobsTable)
    .where(and(eq(mediaJobsTable.mediaType, "photo"), eq(mediaJobsTable.status, "completed")));
  const videoCountResult = await db.select({ c: count() }).from(mediaJobsTable)
    .where(and(eq(mediaJobsTable.mediaType, "video"), eq(mediaJobsTable.status, "completed")));

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const allJobsToday = await db.select({ c: count() }).from(mediaJobsTable)
    .where(sql`${mediaJobsTable.createdAt} >= ${todayStart}`);
  const failedJobsToday = await db.select({ c: count() }).from(mediaJobsTable)
    .where(and(eq(mediaJobsTable.status, "failed"), sql`${mediaJobsTable.createdAt} >= ${todayStart}`));

  const totalUsers = userStats?.total ?? 0;
  const paidUsers = paidUsersResult[0]?.c ?? 0;
  const freeUsers = totalUsers - paidUsers;
  const conversionRate = totalUsers > 0 ? Math.round((paidUsers / totalUsers) * 100) / 100 : 0;

  const recentSignupsRaw = await db.select().from(usersTable)
    .orderBy(desc(usersTable.createdAt)).limit(5);
  const recentPaymentsRaw = await db.select().from(paymentsTable)
    .orderBy(desc(paymentsTable.createdAt)).limit(5);

  res.json({
    totalUsers,
    freeUsers,
    paidUsers,
    totalRevenue: revenueResult[0]?.total ?? 0,
    activeSubscriptions: subscriptionsResult[0]?.c ?? 0,
    totalPhotosProcessed: photoCountResult[0]?.c ?? 0,
    totalVideosProcessed: videoCountResult[0]?.c ?? 0,
    jobsToday: allJobsToday[0]?.c ?? 0,
    failedJobsToday: failedJobsToday[0]?.c ?? 0,
    conversionRate,
    recentSignups: recentSignupsRaw.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      planId: u.planId,
      creditsUsed: u.creditsUsed,
      creditsLimit: u.creditsLimit,
      isSuspended: u.isSuspended,
      createdAt: u.createdAt,
    })),
    recentPayments: recentPaymentsRaw.map(p => ({
      id: p.id,
      userId: p.userId,
      planId: p.planId,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      razorpayOrderId: p.razorpayOrderId,
      razorpayPaymentId: p.razorpayPaymentId,
      billingPeriod: p.billingPeriod,
      createdAt: p.createdAt,
    })),
  });
});

router.get("/admin/users", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const params = ListAdminUsersQueryParams.safeParse(req.query);
  const page = params.success ? (params.data.page ?? 1) : 1;
  const limit = params.success ? (params.data.limit ?? 50) : 50;
  const search = params.success ? params.data.search : undefined;
  const offset = (page - 1) * limit;

  let query = db.select().from(usersTable);
  if (search) {
    query = db.select().from(usersTable).where(
      ilike(usersTable.email, `%${search}%`)
    ) as typeof query;
  }

  const users = await db.select().from(usersTable)
    .orderBy(desc(usersTable.createdAt))
    .limit(limit)
    .offset(offset);

  const totalResult = await db.select({ c: count() }).from(usersTable);
  const total = totalResult[0]?.c ?? 0;

  res.json({
    users: users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      planId: u.planId,
      creditsUsed: u.creditsUsed,
      creditsLimit: u.creditsLimit,
      isSuspended: u.isSuspended,
      createdAt: u.createdAt,
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
});

router.patch("/admin/users/:id/suspend", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const paramsRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(paramsRaw, 10);
  const parsed = SuspendUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db.update(usersTable)
    .set({ isSuspended: parsed.data.suspend })
    .where(eq(usersTable.id, id));

  res.json({ success: true, message: parsed.data.suspend ? "User suspended" : "User unsuspended" });
});

router.patch("/admin/users/:id/credits", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const paramsRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(paramsRaw, 10);
  const parsed = AdjustUserCreditsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db.update(usersTable)
    .set({ creditsLimit: parsed.data.credits })
    .where(eq(usersTable.id, id));

  res.json({ success: true, message: "Credits adjusted" });
});

router.get("/admin/jobs", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const params = ListAdminJobsQueryParams.safeParse(req.query);
  const page = params.success ? (params.data.page ?? 1) : 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const status = params.success ? params.data.status : undefined;

  let jobs;
  if (status) {
    jobs = await db.select().from(mediaJobsTable)
      .where(eq(mediaJobsTable.status, status))
      .orderBy(desc(mediaJobsTable.createdAt))
      .limit(limit).offset(offset);
  } else {
    jobs = await db.select().from(mediaJobsTable)
      .orderBy(desc(mediaJobsTable.createdAt))
      .limit(limit).offset(offset);
  }

  const totalResult = await db.select({ c: count() }).from(mediaJobsTable);
  const total = totalResult[0]?.c ?? 0;

  res.json({
    jobs: jobs.map(j => ({
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

router.get("/admin/payments", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const params = ListAdminPaymentsQueryParams.safeParse(req.query);
  const page = params.success ? (params.data.page ?? 1) : 1;
  const limit = params.success ? (params.data.limit ?? 50) : 50;
  const offset = (page - 1) * limit;

  const payments = await db.select().from(paymentsTable)
    .orderBy(desc(paymentsTable.createdAt))
    .limit(limit).offset(offset);

  const totalResult = await db.select({ c: count() }).from(paymentsTable);
  const total = totalResult[0]?.c ?? 0;

  res.json({
    payments: payments.map(p => ({
      id: p.id,
      userId: p.userId,
      planId: p.planId,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      razorpayOrderId: p.razorpayOrderId,
      razorpayPaymentId: p.razorpayPaymentId,
      billingPeriod: p.billingPeriod,
      createdAt: p.createdAt,
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
});

router.get("/admin/plans", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  const plans = await db.select().from(plansTable);
  res.json(plans.map(p => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    priceMonthly: p.priceMonthly,
    priceAnnual: p.priceAnnual,
    creditsPerMonth: p.creditsPerMonth,
    features: p.features,
    isActive: p.isActive,
    isPopular: p.isPopular,
  })));
});

router.post("/admin/plans", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const parsed = CreatePlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [plan] = await db.insert(plansTable).values({
    ...parsed.data,
    isActive: true,
    isPopular: parsed.data.isPopular ?? false,
  }).returning();

  res.status(201).json({
    id: plan.id,
    name: plan.name,
    slug: plan.slug,
    description: plan.description,
    priceMonthly: plan.priceMonthly,
    priceAnnual: plan.priceAnnual,
    creditsPerMonth: plan.creditsPerMonth,
    features: plan.features,
    isActive: plan.isActive,
    isPopular: plan.isPopular,
  });
});

router.patch("/admin/plans/:id", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const parsed = UpdatePlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [plan] = await db.update(plansTable)
    .set(parsed.data)
    .where(eq(plansTable.id, id))
    .returning();

  if (!plan) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }

  res.json({
    id: plan.id,
    name: plan.name,
    slug: plan.slug,
    description: plan.description,
    priceMonthly: plan.priceMonthly,
    priceAnnual: plan.priceAnnual,
    creditsPerMonth: plan.creditsPerMonth,
    features: plan.features,
    isActive: plan.isActive,
    isPopular: plan.isPopular,
  });
});

router.get("/admin/providers", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  const providers = await db.select().from(providersTable).orderBy(providersTable.priority);
  res.json(providers.map(p => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    isEnabled: p.isEnabled,
    priority: p.priority,
    requestCount: p.requestCount,
    errorCount: p.errorCount,
    lastUsedAt: p.lastUsedAt,
    createdAt: p.createdAt,
  })));
});

router.post("/admin/providers", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const parsed = CreateProviderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [provider] = await db.insert(providersTable).values({
    name: parsed.data.name,
    slug: parsed.data.slug,
    apiKey: parsed.data.apiKey,
    priority: parsed.data.priority ?? 1,
    isEnabled: true,
  }).returning();

  res.status(201).json({
    id: provider.id,
    name: provider.name,
    slug: provider.slug,
    isEnabled: provider.isEnabled,
    priority: provider.priority,
    requestCount: provider.requestCount,
    errorCount: provider.errorCount,
    lastUsedAt: provider.lastUsedAt,
    createdAt: provider.createdAt,
  });
});

router.patch("/admin/providers/:id", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const parsed = UpdateProviderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.apiKey !== undefined) updateData.apiKey = parsed.data.apiKey;
  if (parsed.data.isEnabled !== undefined) updateData.isEnabled = parsed.data.isEnabled;
  if (parsed.data.priority !== undefined) updateData.priority = parsed.data.priority;

  const [provider] = await db.update(providersTable)
    .set(updateData)
    .where(eq(providersTable.id, id))
    .returning();

  if (!provider) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }

  res.json({
    id: provider.id,
    name: provider.name,
    slug: provider.slug,
    isEnabled: provider.isEnabled,
    priority: provider.priority,
    requestCount: provider.requestCount,
    errorCount: provider.errorCount,
    lastUsedAt: provider.lastUsedAt,
    createdAt: provider.createdAt,
  });
});

router.delete("/admin/providers/:id", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  await db.delete(providersTable).where(eq(providersTable.id, id));
  res.json({ success: true, message: "Provider deleted" });
});

router.get("/admin/usage", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  const days = 30;
  const points: { date: string; jobs: number; photos: number; videos: number; revenue: number; signups: number }[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const start = new Date();
    start.setDate(start.getDate() - i);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const jobsResult = await db.select({ c: count() }).from(mediaJobsTable)
      .where(sql`${mediaJobsTable.createdAt} >= ${start} AND ${mediaJobsTable.createdAt} < ${end}`);
    const photosResult = await db.select({ c: count() }).from(mediaJobsTable)
      .where(sql`${mediaJobsTable.createdAt} >= ${start} AND ${mediaJobsTable.createdAt} < ${end} AND ${mediaJobsTable.mediaType} = 'photo'`);
    const videosResult = await db.select({ c: count() }).from(mediaJobsTable)
      .where(sql`${mediaJobsTable.createdAt} >= ${start} AND ${mediaJobsTable.createdAt} < ${end} AND ${mediaJobsTable.mediaType} = 'video'`);
    const revenueResult = await db.select({ total: sum(paymentsTable.amount) }).from(paymentsTable)
      .where(sql`${paymentsTable.createdAt} >= ${start} AND ${paymentsTable.createdAt} < ${end} AND ${paymentsTable.status} = 'success'`);
    const signupsResult = await db.select({ c: count() }).from(usersTable)
      .where(sql`${usersTable.createdAt} >= ${start} AND ${usersTable.createdAt} < ${end}`);

    points.push({
      date: start.toISOString().slice(0, 10),
      jobs: jobsResult[0]?.c ?? 0,
      photos: photosResult[0]?.c ?? 0,
      videos: videosResult[0]?.c ?? 0,
      revenue: Number(revenueResult[0]?.total ?? 0),
      signups: signupsResult[0]?.c ?? 0,
    });
  }

  res.json({ daily: points });
});

router.get("/admin/funnel", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  const totalUsers = await db.select({ c: count() }).from(usersTable);
  const usedAtLeastOne = await db.select({ c: count() }).from(mediaJobsTable)
    .where(sql`${mediaJobsTable.userId} IS NOT NULL`)
    .groupBy(mediaJobsTable.userId);
  const paidUsers = await db.select({ c: count() }).from(usersTable)
    .where(sql`${usersTable.planId} IS NOT NULL`);
  const activeThisWeek = await db.select({ c: count() }).from(mediaJobsTable)
    .where(sql`${mediaJobsTable.createdAt} >= NOW() - INTERVAL '7 days'`)
    .groupBy(mediaJobsTable.userId);

  res.json({
    registered: totalUsers[0]?.c ?? 0,
    activated: usedAtLeastOne.length,
    converted: paidUsers[0]?.c ?? 0,
    retained: activeThisWeek.length,
  });
});

export default router;
