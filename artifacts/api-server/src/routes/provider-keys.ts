import { Router, IRouter } from "express";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { providerKeyManager } from "../lib/provider-key-manager";
import { aiProvider, feedbackAccumulator } from "../lib/ai-provider";
import { db, apiKeysTable, apiKeyDailyUsageTable, enhancementLogsTable, mediaJobsTable, usersTable } from "@workspace/db";
import { eq, desc, sql, count, sum, and } from "drizzle-orm";

const router: IRouter = Router();

// Load keys from .env and validate them
router.post("/admin/provider-keys/load-env", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  const loaded = await providerKeyManager.loadFromEnv();
  const validation = await providerKeyManager.validateAll();
  providerKeyManager.startHealthChecks();
  res.json({ loaded, validation });
});

// Bulk import keys
router.post("/admin/provider-keys/bulk-import", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { keys, provider, model, tier } = req.body as {
    keys: string[];
    provider: "openrouter" | "gemini";
    model: string;
    tier?: "free" | "premium";
  };
  if (!Array.isArray(keys) || keys.length === 0 || !provider || !model) {
    res.status(400).json({ error: "keys[], provider, and model are required" });
    return;
  }
  const added = await providerKeyManager.loadBulkKeys(keys, provider, model, tier ?? "free");
  res.json({ added, totalKeys: providerKeyManager.getStatus().totalKeys });
});

// Validate all keys
router.post("/admin/provider-keys/validate-all", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  const result = await providerKeyManager.validateAll();
  res.json(result);
});

// Get all keys (masked) with status
router.get("/admin/provider-keys", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  res.json({ keys: providerKeyManager.getSafeEntries() });
});

// Get status summary
router.get("/admin/provider-keys/status", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  res.json(providerKeyManager.getStatus());
});

// Get available models
router.get("/admin/provider-keys/models", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  res.json({ models: providerKeyManager.getAvailableModels() });
});

// Toggle key active/inactive
router.patch("/admin/provider-keys/:id/status", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const { status } = req.body as { status: "active" | "inactive" };
  if (!status) {
    res.status(400).json({ error: "status is required" });
    return;
  }
  const ok = await providerKeyManager.setKeyStatus(id, status);
  if (!ok) {
    res.status(404).json({ error: "Key not found" });
    return;
  }
  res.json({ success: true });
});

// Change key tier
router.patch("/admin/provider-keys/:id/tier", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const { tier } = req.body as { tier: "free" | "premium" };
  if (!tier) {
    res.status(400).json({ error: "tier is required" });
    return;
  }
  const ok = await providerKeyManager.setKeyTier(id, tier);
  if (!ok) {
    res.status(404).json({ error: "Key not found" });
    return;
  }
  res.json({ success: true });
});

// Remove a key
router.delete("/admin/provider-keys/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const ok = await providerKeyManager.removeKey(id);
  if (!ok) {
    res.status(404).json({ error: "Key not found" });
    return;
  }
  res.json({ success: true });
});

// Pick best key (for testing)
router.get("/admin/provider-keys/pick", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const tier = (req.query.tier as string) ?? "free";
  const entry = providerKeyManager.pickKeyForTier(tier as "free" | "premium");
  if (!entry) {
    res.status(404).json({ error: "No active key found" });
    return;
  }
  res.json({
    keyPrefix: entry.key.slice(0, 12) + "..." + entry.key.slice(-4),
    provider: entry.provider,
    model: entry.model,
    tier: entry.tier,
    status: entry.status,
    latencyMs: entry.latencyMs,
  });
});

// ─── ANALYTICS ROUTES ────────────────────────────────────────────

// Per-key daily usage for last N days
router.get("/admin/analytics/key-usage", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const days = parseInt(req.query.days as string) || 30;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoff = cutoffDate.toISOString().slice(0, 10);

  const usage = await db.select({
    apiKeyId: apiKeyDailyUsageTable.apiKeyId,
    date: apiKeyDailyUsageTable.date,
    callCount: apiKeyDailyUsageTable.callCount,
    errorCount: apiKeyDailyUsageTable.errorCount,
    avgLatencyMs: apiKeyDailyUsageTable.avgLatencyMs,
  })
    .from(apiKeyDailyUsageTable)
    .where(sql`${apiKeyDailyUsageTable.date} >= ${cutoff}`)
    .orderBy(desc(apiKeyDailyUsageTable.date));

  // Attach key info
  const keys = providerKeyManager.getSafeEntries();
  const keyMap = new Map(keys.map(k => [k.id, k]));

  const enriched = usage.map(u => ({
    ...u,
    key: keyMap.get(u.apiKeyId) ?? null,
  }));

  res.json({ usage: enriched });
});

// Daily enhancement summary
router.get("/admin/analytics/daily-summary", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const days = parseInt(req.query.days as string) || 30;
  const points: { date: string; totalEnhancements: number; avgProcessingMs: number; uniqueUsers: number }[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const start = new Date();
    start.setDate(start.getDate() - i);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const result = await db.select({
      total: count(),
      avgMs: sql<number>`COALESCE(AVG(${mediaJobsTable.processingTimeMs}), 0)::int`,
    }).from(mediaJobsTable)
      .where(sql`${mediaJobsTable.createdAt} >= ${start} AND ${mediaJobsTable.createdAt} < ${end} AND ${mediaJobsTable.status} = 'completed'`);

    const uniqueResult = await db.select({
      c: sql<number>`COUNT(DISTINCT ${mediaJobsTable.userId})`,
    }).from(mediaJobsTable)
      .where(sql`${mediaJobsTable.createdAt} >= ${start} AND ${mediaJobsTable.createdAt} < ${end}`);

    points.push({
      date: start.toISOString().slice(0, 10),
      totalEnhancements: result[0]?.total ?? 0,
      avgProcessingMs: result[0]?.avgMs ?? 0,
      uniqueUsers: uniqueResult[0]?.c ?? 0,
    });
  }

  res.json({ daily: points });
});

// Enhancement type breakdown
router.get("/admin/analytics/enhancement-types", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  const result = await db.select({
    type: mediaJobsTable.enhancementType,
    total: count(),
  }).from(mediaJobsTable)
    .where(sql`${mediaJobsTable.enhancementType} IS NOT NULL AND ${mediaJobsTable.status} = 'completed'`)
    .groupBy(mediaJobsTable.enhancementType)
    .orderBy(sql`count(*) DESC`);

  res.json({ types: result });
});

// Top users by enhancement count
router.get("/admin/analytics/top-users", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const limitN = parseInt(req.query.limit as string) || 20;

  const result = await db.select({
    userId: mediaJobsTable.userId,
    totalJobs: count(),
    completedJobs: sql<number>`SUM(CASE WHEN ${mediaJobsTable.status} = 'completed' THEN 1 ELSE 0 END)::int`,
    avgProcessingMs: sql<number>`COALESCE(AVG(${mediaJobsTable.processingTimeMs}), 0)::int`,
  }).from(mediaJobsTable)
    .groupBy(mediaJobsTable.userId)
    .orderBy(sql`count(*) DESC`)
    .limit(limitN);

  // Enrich with user info
  const enriched = await Promise.all(result.map(async (r) => {
    const [user] = await db.select({
      name: usersTable.name,
      email: usersTable.email,
      planId: usersTable.planId,
      creditsUsed: usersTable.creditsUsed,
      creditsLimit: usersTable.creditsLimit,
    }).from(usersTable).where(eq(usersTable.id, r.userId));

    return { ...r, user: user ?? null };
  }));

  res.json({ users: enriched });
});

// Monthly summary
router.get("/admin/analytics/monthly-summary", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  const result = await db.select({
    month: sql<string>`TO_CHAR(${mediaJobsTable.createdAt}, 'YYYY-MM')`,
    totalJobs: count(),
    completed: sql<number>`SUM(CASE WHEN ${mediaJobsTable.status} = 'completed' THEN 1 ELSE 0 END)::int`,
    failed: sql<number>`SUM(CASE WHEN ${mediaJobsTable.status} = 'failed' THEN 1 ELSE 0 END)::int`,
    avgProcessingMs: sql<number>`COALESCE(AVG(${mediaJobsTable.processingTimeMs}), 0)::int`,
    uniqueUsers: sql<number>`COUNT(DISTINCT ${mediaJobsTable.userId})`,
  }).from(mediaJobsTable)
    .groupBy(sql`TO_CHAR(${mediaJobsTable.createdAt}, 'YYYY-MM')`)
    .orderBy(sql`TO_CHAR(${mediaJobsTable.createdAt}, 'YYYY-MM') DESC`)
    .limit(12);

  res.json({ months: result });
});

// ─── Key Usage Report ──────────────────────────────────────────────────────
// Detailed report: which keys are used, which aren't, priority cascade status
router.get("/admin/provider-keys/usage-report", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  res.json(providerKeyManager.getUsageReport());
});

// ─── Centralized AI Insights ────────────────────────────────────────────────
// Aggregated view: provider health, feedback stats, enhancement performance, system status
router.get("/admin/ai-insights", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  const providerPool = aiProvider.getPoolStats();
  const feedbackStats = feedbackAccumulator.getStats();
  const keyUsage = providerKeyManager.getUsageReport();

  // Enhancement performance from recent jobs
  const recentJobs = await db.select({
    enhancementType: mediaJobsTable.enhancementType,
    status: mediaJobsTable.status,
    processingTimeMs: mediaJobsTable.processingTimeMs,
  }).from(mediaJobsTable)
    .orderBy(desc(mediaJobsTable.createdAt))
    .limit(200);

  const enhancementPerf: Record<string, { total: number; completed: number; failed: number; avgMs: number }> = {};
  for (const j of recentJobs) {
    const t = j.enhancementType ?? "unknown";
    if (!enhancementPerf[t]) enhancementPerf[t] = { total: 0, completed: 0, failed: 0, avgMs: 0 };
    enhancementPerf[t].total++;
    if (j.status === "completed") {
      enhancementPerf[t].completed++;
      enhancementPerf[t].avgMs += (j.processingTimeMs ?? 0);
    } else if (j.status === "failed") {
      enhancementPerf[t].failed++;
    }
  }
  // Calculate averages
  for (const p of Object.values(enhancementPerf)) {
    if (p.completed > 0) p.avgMs = Math.round(p.avgMs / p.completed);
  }

  // System health summary
  const healthyKeys = providerPool.healthy;
  const totalKeys = providerPool.total;
  const systemHealth = totalKeys === 0 ? "no_keys" :
    healthyKeys === totalKeys ? "healthy" :
    healthyKeys > 0 ? "degraded" : "critical";

  res.json({
    systemHealth,
    providerPool,
    feedbackStats,
    enhancementPerformance: enhancementPerf,
    keyUsageSummary: {
      totalKeys: keyUsage.summary.totalKeys ?? totalKeys,
      activeProviders: Object.entries(providerPool.byProvider)
        .filter(([_, count]) => count > 0)
        .map(([provider]) => provider),
    },
    // Task 12: Expanded metadata
    topEnhancements: Object.entries(enhancementPerf)
      .sort(([, a], [, b]) => b.total - a.total)
      .slice(0, 5)
      .map(([type, stats]) => ({ type, ...stats })),
    successRate: (() => {
      const totals = Object.values(enhancementPerf).reduce((acc, p) => ({ c: acc.c + p.completed, t: acc.t + p.total }), { c: 0, t: 0 });
      return totals.t > 0 ? Math.round((totals.c / totals.t) * 100) : 0;
    })(),
    cacheStats: {
      note: "Enhancement cache is in-memory, stats available via /health endpoint",
    },
    generatedAt: new Date().toISOString(),
  });
});

export default router;
