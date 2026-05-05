import { Router, IRouter, Response } from "express";
import { db, mediaJobsTable, usersTable, presetsTable, plansTable } from "@workspace/db";
import { eq, and, desc, count } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import {
  UploadMediaBody,
  EnhanceMediaBody,
  ListMediaJobsQueryParams,
  ListPresetsQueryParams,
  RenderMediaPreviewBody,
} from "@workspace/api-zod";
import { enhanceImage, renderPreviewImage, callVideoRestoration, callBatchRestoration } from "../lib/image-enhancer";
import { runEnhancementChain, validateChainSpec, type ChainSpec, type UpscaleOp } from "../lib/enhancement-pipeline";
import { aiProvider, feedbackAccumulator, type UserTier } from "../lib/ai-provider";
import { formatApiError } from "../lib/api-errors";
import { checkTierAccess } from "../lib/tier-config";
import {
  resolveEffectivePlanSlug,
  maxBatchJobsForPlan,
  downgradeExpiredSubscription,
} from "../lib/entitlements";
import { buildMediaReferenceCode } from "../lib/media-reference";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/** AI provider tier: paid effective tier → premium vision routing; free → cheaper/local-only */
function getUserTierForAi(planSlug: string | null, user: typeof usersTable.$inferSelect): UserTier {
  const slug = resolveEffectivePlanSlug(planSlug, {
    role: user.role,
    planId: user.planId,
    planExpiresAt: user.planExpiresAt,
    premiumTrialEndsAt: user.premiumTrialEndsAt,
  });
  return slug === "free" ? "free" : "premium";
}

/** Admins are exempt from all quota enforcement */
const isAdmin = (req: AuthRequest) => req.userRole === "admin";

const processingJobStaleMs = Number.parseInt(process.env.PROCESSING_JOB_STALE_MS ?? "900000", 10);

function setNoStore(res: Response) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
}

async function recoverInterruptedProcessingJob(job: typeof mediaJobsTable.$inferSelect) {
  if (job.status !== "processing") return job;
  const staleAfter = Number.isFinite(processingJobStaleMs) && processingJobStaleMs > 0
    ? processingJobStaleMs
    : 900000;
  const lastTouched = job.updatedAt ?? job.createdAt;
  if (Date.now() - lastTouched.getTime() < staleAfter) return job;

  const [failed] = await db.update(mediaJobsTable).set({
    status: "failed",
    errorMessage: "Processing was interrupted by a server restart. Please retry the enhancement.",
    updatedAt: new Date(),
  }).where(eq(mediaJobsTable.id, job.id)).returning();

  logger.warn({ jobId: job.id, staleAfter }, "Recovered interrupted processing job");
  return failed ?? job;
}

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
    referenceCode: j.referenceCode ?? null,
    createdAt: j.createdAt,
    completedAt: j.completedAt,
  };
}

/**
 * Lightweight version for list endpoints — returns thumbnails but omits
 * the huge full-size base64 blobs (originalUrl, processedUrl) to avoid
 * RangeError: Invalid string length on JSON.stringify.
 */
function jobToListResponse(j: typeof mediaJobsTable.$inferSelect) {
  const guessMime = (b64: string | null): string => {
    if (!b64) return "image/jpeg";
    if (b64.startsWith("data:")) return "image/jpeg";
    if (b64.startsWith("/9j/")) return "image/jpeg";
    if (b64.startsWith("iVBOR")) return "image/png";
    if (b64.startsWith("R0lGO")) return "image/gif";
    if (b64.startsWith("UklGR")) return "image/webp";
    return "image/jpeg";
  };
  const toDataUri = (b64: string | null): string | null => {
    if (!b64) return null;
    if (b64.startsWith("data:")) return b64;
    return `data:${guessMime(b64)};base64,${b64}`;
  };

  return {
    id: j.id,
    userId: j.userId,
    mediaType: j.mediaType,
    status: j.status,
    filename: j.filename,
    originalUrl: null,       // omitted for list — fetch single job for full data
    processedUrl: null,      // omitted for list
    thumbnailUrl: toDataUri(j.thumbnailUrl),  // small enough to include
    enhancementType: j.enhancementType,
    presetId: j.presetId,
    errorMessage: j.errorMessage,
    processingTimeMs: j.processingTimeMs,
    fileSize: j.fileSize,
    referenceCode: j.referenceCode ?? null,
    createdAt: j.createdAt,
    completedAt: j.completedAt,
  };
}

// ── Daily quota helper ────────────────────────────────────────
function resetDailyIfNeeded(user: { dailyCreditsUsed: number; dailyResetAt: Date | null }) {
  const now = new Date();
  if (!user.dailyResetAt || now >= user.dailyResetAt) {
    return { dailyCreditsUsed: 0, dailyResetAt: getNextMidnightUTC() };
  }
  return null; // no reset needed
}

function getNextMidnightUTC(): Date {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d;
}

// ─── Upload ───────────────────────────────────────────────────
router.post("/media/upload", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = UploadMediaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await downgradeExpiredSubscription(req.userId!);

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Reset daily counter if past midnight
  const dailyReset = resetDailyIfNeeded(user);
  if (dailyReset) {
    await db.update(usersTable).set(dailyReset).where(eq(usersTable.id, user.id));
    user.dailyCreditsUsed = 0;
  }

  // Enforce monthly limit (admins are exempt)
  if (!isAdmin(req) && user.creditsUsed >= user.creditsLimit) {
    const isPaid = user.planId !== null;
    res.status(403).json({
      error: isPaid
        ? "Monthly enhancement limit reached. Your quota resets on your next billing cycle."
        : "Free trial limit reached (5 enhancements). Upgrade to continue creating.",
      code: "QUOTA_EXCEEDED",
      quotaType: "monthly",
    });
    return;
  }

  // Enforce daily limit — admins are exempt; free users have no separate daily limit
  if (!isAdmin(req) && user.planId && user.dailyCreditsUsed >= user.dailyLimit) {
    res.status(403).json({
      error: "Daily enhancement limit reached. Come back tomorrow or upgrade your plan.",
      code: "QUOTA_EXCEEDED",
      quotaType: "daily",
    });
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

  await downgradeExpiredSubscription(req.userId!);

  // ── Tier-based feature gating ──
  if (!isAdmin(req)) {
    const [enhUser] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
    let planSlug: string | null = null;
    if (enhUser?.planId) {
      const [plan] = await db.select({ slug: plansTable.slug }).from(plansTable).where(eq(plansTable.id, enhUser.planId));
      planSlug = plan?.slug ?? null;
    }
    const tierSlug = resolveEffectivePlanSlug(planSlug, {
      role: enhUser!.role,
      planId: enhUser!.planId,
      planExpiresAt: enhUser!.planExpiresAt,
      premiumTrialEndsAt: enhUser!.premiumTrialEndsAt,
    });
    const filterId = (settings as Record<string, unknown> | undefined)?.filterId as string | undefined;
    const filterName = filterId ?? ((settings as Record<string, unknown> | undefined)?.filterName as string | undefined);
    const tierError = checkTierAccess(tierSlug, enhancementType, filterName);
    if (tierError) {
      res.status(403).json({ error: tierError, code: "TIER_RESTRICTED" });
      return;
    }
  }

  const startTime = Date.now();

  // Mark processing
  await db.update(mediaJobsTable)
    .set({ status: "processing", enhancementType, presetId: presetId ?? null, updatedAt: new Date() })
    .where(eq(mediaJobsTable.id, jobId));

  // Debit credit (monthly + daily)
  await db.update(usersTable)
    .set({
      creditsUsed: sql`${usersTable.creditsUsed} + 1`,
      dailyCreditsUsed: sql`${usersTable.dailyCreditsUsed} + 1`,
    })
    .where(eq(usersTable.id, req.userId!));

  // Respond immediately with "processing" status
  const [processing] = await db.select().from(mediaJobsTable).where(eq(mediaJobsTable.id, jobId));
  res.json(jobToResponse(processing));

  // ── Background: real image/video enhancement ──
  // Helper: update job progress message (non-blocking, swallows errors)
  const setProgress = (msg: string) =>
    db.update(mediaJobsTable).set({ errorMessage: msg, updatedAt: new Date() }).where(eq(mediaJobsTable.id, jobId)).catch(() => {});

  try {
    const rawB64 = job.base64Data;

    // ── Video Restoration (separate pipeline) ──
    if (enhancementType === "video_restore") {
      const s = (settings ?? {}) as Record<string, unknown>;
      const videoMode = (s.videoMode as string) || "upscale_2x";
      const faceEnhance = s.faceEnhance !== false;
      const temporalConsistency = s.temporalConsistency !== false;
      const restorationModel = (s.restorationModel as string) || "auto";
      const videoColorGrade = s.videoColorGrade as string | undefined;
      // Forward Photo-Studio-style filter + upscale settings so video has
      // feature parity with the image pipeline.
      const filterId = s.filterId as string | undefined;
      const upscale = s.upscale as string | undefined;

      setProgress("Sending to video restoration pipeline…");
      const result = await callVideoRestoration(
        rawB64,
        videoMode,
        faceEnhance,
        300,
        temporalConsistency,
        restorationModel,
        videoColorGrade ?? null,
        filterId ?? null,
        upscale ?? null,
      );

      const completedAt = new Date();
      const referenceCode = buildMediaReferenceCode({
        jobId,
        enhancementType,
        completedAt,
        suffix: "",
      });

      await db.update(mediaJobsTable).set({
        status: "completed",
        processedUrl: result.base64,
        thumbnailUrl: result.base64,
        processingTimeMs: Date.now() - startTime,
        completedAt,
        referenceCode,
        errorMessage: null,
        updatedAt: new Date(),
      }).where(eq(mediaJobsTable.id, jobId));

      logger.info({ jobId, type: enhancementType, frames: result.framesProcessed, scenes: result.sceneChanges, ms: result.processingMs }, "Video restoration completed");
      return;
    }

    // ── Image Enhancement (sharp + AI restoration sidecar) ──
    let mimeType = "image/jpeg";
    if (rawB64.startsWith("iVBOR")) mimeType = "image/png";
    else if (rawB64.startsWith("UklGR")) mimeType = "image/webp";

    const perf: Record<string, number> = {};
    const mark = (step: string) => { perf[step] = Date.now() - startTime; };

    // Get AI guidance from LLM vision models (non-blocking, 15s timeout fallback)
    // Pass user tier so free users don't consume Gemini keys
    const [enhUser] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
    let planSlugAi: string | null = null;
    if (enhUser?.planId) {
      const [pl] = await db.select({ slug: plansTable.slug }).from(plansTable).where(eq(plansTable.id, enhUser.planId));
      planSlugAi = pl?.slug ?? null;
    }
    const userTier = enhUser ? getUserTierForAi(planSlugAi, enhUser) : "free";
    let aiGuidance = null;
    mark("guidance_start");
    try {
      setProgress("Acquiring AI guidance…");
      // Race: AI guidance vs 15s timeout — never block enhancement for slow API keys
      const guidancePromise = aiProvider.getEnhancementGuidance(rawB64, mimeType, enhancementType, userTier);
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000));
      aiGuidance = await Promise.race([guidancePromise, timeoutPromise]);
      mark("guidance_done");
      if (aiGuidance) {
        logger.info({ source: aiGuidance.source, type: enhancementType }, "AI guidance acquired for enhancement");
      } else {
        logger.info({ type: enhancementType }, "AI guidance unavailable or timed out — proceeding with local heuristics");
      }
    } catch (guidanceErr) {
      mark("guidance_done");
      logger.warn({ err: guidanceErr }, "AI guidance failed — proceeding without");
    }

    mark("enhance_start");
    setProgress("Enhancing image…");
    const result = await enhanceImage(rawB64, mimeType, {
      enhancementType,
      settings: settings as Record<string, unknown> | undefined,
      aiGuidance,
    });
    mark("enhance_done");

    setProgress("Saving result…");
    const completedAt = new Date();
    const referenceCode = buildMediaReferenceCode({
      jobId,
      enhancementType,
      completedAt,
      suffix: "",
    });
    // Store raw base64 in DB (no prefix — jobToResponse adds it)
    await db.update(mediaJobsTable).set({
      status: "completed",
      processedUrl: result.base64,
      thumbnailUrl: result.base64,
      processingTimeMs: Date.now() - startTime,
      completedAt,
      referenceCode,
      errorMessage: null,
      updatedAt: new Date(),
    }).where(eq(mediaJobsTable.id, jobId));
    mark("db_save");

    logger.info({ jobId, type: enhancementType, ms: Date.now() - startTime, perf }, "Enhancement completed");
  } catch (err) {
    logger.error({ err, jobId }, "Enhancement failed");
    await db.update(mediaJobsTable).set({
      status: "failed",
      processingTimeMs: Date.now() - startTime,
      errorMessage: err instanceof Error ? err.message : "Enhancement failed",
      updatedAt: new Date(),
    }).where(eq(mediaJobsTable.id, jobId));
  }
});

// ─── Canonical preview render ────────────────────────────────
router.post("/media/preview", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = RenderMediaPreviewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { base64Data, mimeType, enhancementType, settings, previewMaxDimension } = parsed.data;

  await downgradeExpiredSubscription(req.userId!);

  if (!isAdmin(req)) {
    const [previewUser] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
    let planSlug: string | null = null;
    if (previewUser?.planId) {
      const [plan] = await db.select({ slug: plansTable.slug }).from(plansTable).where(eq(plansTable.id, previewUser.planId));
      planSlug = plan?.slug ?? null;
    }
    const tierSlug = resolveEffectivePlanSlug(planSlug, {
      role: previewUser!.role,
      planId: previewUser!.planId,
      planExpiresAt: previewUser!.planExpiresAt,
      premiumTrialEndsAt: previewUser!.premiumTrialEndsAt,
    });
    const filterId = (settings as Record<string, unknown> | undefined)?.filterId as string | undefined;
    const filterName = filterId ?? ((settings as Record<string, unknown> | undefined)?.filterName as string | undefined);
    const tierError = checkTierAccess(tierSlug, enhancementType, filterName);
    if (tierError) {
      res.status(403).json({ error: tierError, code: "TIER_RESTRICTED" });
      return;
    }
  }

  try {
    const result = await renderPreviewImage(
      base64Data,
      mimeType,
      {
        enhancementType,
        settings: settings as Record<string, unknown> | undefined,
      },
      previewMaxDimension ?? 1600,
    );
    res.json(result);
  } catch (err) {
    logger.error({ err, enhancementType }, "Preview render failed");
    res.status(500).json({ error: "Failed to render preview" });
  }
});

// ─── Analyze (AI suggestion) ──────────────────────────────────
router.post("/media/analyze", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { jobId } = req.body;
  if (!jobId || typeof jobId !== "number") {
    res.status(400).json({ error: "jobId (number) is required" });
    return;
  }

  await downgradeExpiredSubscription(req.userId!);

  const [job] = await db.select().from(mediaJobsTable)
    .where(and(eq(mediaJobsTable.id, jobId), eq(mediaJobsTable.userId, req.userId!)));

  if (!job || !job.base64Data) {
    res.status(404).json({ error: "Job not found or no image data" });
    return;
  }

  const mimeType = job.base64Data.startsWith("iVBOR") ? "image/png"
    : job.base64Data.startsWith("UklGR") ? "image/webp" : "image/jpeg";

  // Determine user tier for tier-aware AI routing
  const [analyzeUser] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  let planSlugAnalyze: string | null = null;
  if (analyzeUser?.planId) {
    const [pl] = await db.select({ slug: plansTable.slug }).from(plansTable).where(eq(plansTable.id, analyzeUser.planId));
    planSlugAnalyze = pl?.slug ?? null;
  }
  const userTier = analyzeUser ? getUserTierForAi(planSlugAnalyze, analyzeUser) : "free";

  try {
    const result = await aiProvider.analyzeImage(job.base64Data, mimeType, userTier, job.filename);
    if (result) {
      // If AI failed and we have a failure cause, format error for user/admin
      if (result.failureCause) {
        const apiErr = formatApiError({
          cause: result.failureCause,
          provider: "all",
          userRole: req.userRole,
        });
        // Still return the local analysis result, but attach warning
        res.json({
          ...result,
          warning: apiErr.error,
          ...(apiErr.adminInsight ? { adminInsight: apiErr.adminInsight } : {}),
        });
        return;
      }
      res.json(result);
      return;
    }
  } catch (err) {
    logger.warn({ err }, "AI analysis failed — running local fallback");
  }

  // Last-resort: local analysis always produces a confident result
  try {
    const localResult = await aiProvider.localAnalyzeImage(job.base64Data, mimeType, job.filename);
    res.json(localResult);
    return;
  } catch {
    // Should never reach here
  }

  res.json({
    description: "Image ready for enhancement.",
    suggestedEnhancement: "auto",
    suggestedFilter: null,
    detectedSubjects: [],
    confidence: 0.72,
    analysisSource: "local",
  });
});

// ─── List jobs ────────────────────────────────────────────────
// Select only lightweight columns — skip base64Data, processedUrl, originalUrl blobs
// that can be multi-MB each, causing 20+ second query times.
const listColumns = {
  id: mediaJobsTable.id,
  userId: mediaJobsTable.userId,
  mediaType: mediaJobsTable.mediaType,
  status: mediaJobsTable.status,
  filename: mediaJobsTable.filename,
  thumbnailUrl: mediaJobsTable.thumbnailUrl,
  enhancementType: mediaJobsTable.enhancementType,
  presetId: mediaJobsTable.presetId,
  errorMessage: mediaJobsTable.errorMessage,
  processingTimeMs: mediaJobsTable.processingTimeMs,
  fileSize: mediaJobsTable.fileSize,
  referenceCode: mediaJobsTable.referenceCode,
  createdAt: mediaJobsTable.createdAt,
  completedAt: mediaJobsTable.completedAt,
};

router.get("/media/jobs", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const params = ListMediaJobsQueryParams.safeParse(req.query);
  const status = params.success ? params.data.status : undefined;

  let jobs;
  if (status && status !== "all") {
    jobs = await db.select(listColumns).from(mediaJobsTable)
      .where(and(eq(mediaJobsTable.userId, req.userId!), eq(mediaJobsTable.status, status)))
      .orderBy(desc(mediaJobsTable.createdAt))
      .limit(50);
  } else {
    jobs = await db.select(listColumns).from(mediaJobsTable)
      .where(eq(mediaJobsTable.userId, req.userId!))
      .orderBy(desc(mediaJobsTable.createdAt))
      .limit(50);
  }

  // jobToListResponse expects full row shape — map lightweight rows directly
  res.json(jobs.map(j => {
    const guessMime = (b64: string | null): string => {
      if (!b64) return "image/jpeg";
      if (b64.startsWith("data:")) return "image/jpeg";
      if (b64.startsWith("/9j/")) return "image/jpeg";
      if (b64.startsWith("iVBOR")) return "image/png";
      if (b64.startsWith("R0lGO")) return "image/gif";
      if (b64.startsWith("UklGR")) return "image/webp";
      return "image/jpeg";
    };
    const toDataUri = (b64: string | null): string | null => {
      if (!b64) return null;
      if (b64.startsWith("data:")) return b64;
      return `data:${guessMime(b64)};base64,${b64}`;
    };
    return {
      id: j.id,
      userId: j.userId,
      mediaType: j.mediaType,
      status: j.status,
      filename: j.filename,
      originalUrl: null,
      processedUrl: null,
      thumbnailUrl: toDataUri(j.thumbnailUrl),
      enhancementType: j.enhancementType,
      presetId: j.presetId,
      errorMessage: j.errorMessage,
      processingTimeMs: j.processingTimeMs,
      fileSize: j.fileSize,
      referenceCode: j.referenceCode ?? null,
      createdAt: j.createdAt,
      completedAt: j.completedAt,
    };
  }));
});

// ─── Get single job ───────────────────────────────────────────
router.get("/media/jobs/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  setNoStore(res);

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

  const recoveredJob = await recoverInterruptedProcessingJob(job);
  res.json(jobToResponse(recoveredJob));
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

// ─── Self-learning feedback loop ───────────────────────────────────────────
// POST /media/feedback — called from editor when user applies/dismisses an AI suggestion
// Updates the in-memory feedback accumulator to bias future confidence scores
router.post("/media/feedback", requireAuth, async (req, res): Promise<void> => {
  const { enhancement, action } = req.body as { enhancement?: string; action?: string };
  if (!enhancement || !["applied", "dismissed"].includes(action ?? "")) {
    res.status(400).json({ error: "enhancement and action (applied|dismissed) are required" });
    return;
  }
  feedbackAccumulator.record(enhancement, action as "applied" | "dismissed");
  res.json({ ok: true, stats: feedbackAccumulator.getStats()[enhancement] });
});

// ─── Chain Enhancement ─────────────────────────────────────────
// POST /media/enhance-chain — run a 1-3 stage chain (enhance → filter → upscale)
// server-side and produce a single completed job. Replaces the old client-side
// upscaleChainRef hack which created two job rows per chain.
router.post("/media/enhance-chain", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const body = req.body as {
    jobId?: number;
    enhance?: string | null;
    filterId?: string | null;
    upscale?: string | null;
    settings?: Record<string, unknown>;
  };

  if (typeof body.jobId !== "number") {
    res.status(400).json({ error: "jobId (number) is required" });
    return;
  }

  const spec: ChainSpec = {
    enhance: body.enhance ?? null,
    filterId: body.filterId ?? null,
    upscale: (body.upscale as UpscaleOp | null | undefined) ?? null,
    settings: body.settings,
  };
  const validation = validateChainSpec(spec);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }

  const [job] = await db.select().from(mediaJobsTable)
    .where(and(eq(mediaJobsTable.id, body.jobId), eq(mediaJobsTable.userId, req.userId!)));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (!job.base64Data) {
    res.status(400).json({ error: "No image data available for this job" });
    return;
  }

  await downgradeExpiredSubscription(req.userId!);

  // Tier check — apply to every stage (each stage may itself be tier-gated)
  if (!isAdmin(req)) {
    const [chainUser] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
    let planSlug: string | null = null;
    if (chainUser?.planId) {
      const [plan] = await db.select({ slug: plansTable.slug }).from(plansTable).where(eq(plansTable.id, chainUser.planId));
      planSlug = plan?.slug ?? null;
    }
    const tierSlug = resolveEffectivePlanSlug(planSlug, {
      role: chainUser!.role,
      planId: chainUser!.planId,
      planExpiresAt: chainUser!.planExpiresAt,
      premiumTrialEndsAt: chainUser!.premiumTrialEndsAt,
    });

    const stagesToCheck: Array<{ op: string | null | undefined; filter?: string | null }> = [
      { op: spec.enhance, filter: spec.filterId },
      { op: spec.upscale },
    ];
    for (const stage of stagesToCheck) {
      if (!stage.op) continue;
      const tierError = checkTierAccess(tierSlug, stage.op, stage.filter ?? undefined);
      if (tierError) {
        res.status(403).json({ error: tierError, code: "TIER_RESTRICTED" });
        return;
      }
    }
  }

  const startTime = Date.now();
  // Use the primary enhancement type for DB labelling (so History badges show
  // the most meaningful op). Falls back to filter-only / upscale-only labels.
  const primaryOp = spec.enhance ?? (spec.filterId ? "filter" : (spec.upscale ?? "auto"));

  await db.update(mediaJobsTable)
    .set({ status: "processing", enhancementType: primaryOp })
    .where(eq(mediaJobsTable.id, body.jobId));
  await db.update(usersTable)
    .set({
      creditsUsed: sql`${usersTable.creditsUsed} + 1`,
      dailyCreditsUsed: sql`${usersTable.dailyCreditsUsed} + 1`,
    })
    .where(eq(usersTable.id, req.userId!));

  const [processing] = await db.select().from(mediaJobsTable).where(eq(mediaJobsTable.id, body.jobId));
  res.json(jobToResponse(processing));

  try {
    const rawB64 = job.base64Data;
    let mimeType = "image/jpeg";
    if (rawB64.startsWith("iVBOR")) mimeType = "image/png";
    else if (rawB64.startsWith("UklGR")) mimeType = "image/webp";

    const result = await runEnhancementChain(rawB64, mimeType, spec);

    const completedAt = new Date();
    const referenceCode = buildMediaReferenceCode({
      jobId: body.jobId,
      enhancementType: primaryOp,
      completedAt,
      suffix: spec.filterId ? `-${spec.filterId}` : "",
    });

    // Encode chain metadata into errorMessage (repurposed) — UI reads this to
    // show enhance + filter + upscale badges on a single History row.
    const chainMeta = JSON.stringify({
      chain: result.stages.map(s => ({ stage: s.stage, op: s.op })),
      servedBy: result.servedBy,
    });

    await db.update(mediaJobsTable).set({
      status: "completed",
      processedUrl: result.base64,
      thumbnailUrl: result.base64,
      processingTimeMs: Date.now() - startTime,
      completedAt,
      referenceCode,
      errorMessage: chainMeta,
    }).where(eq(mediaJobsTable.id, body.jobId));

    logger.info({
      jobId: body.jobId,
      stages: result.stages,
      servedBy: result.servedBy,
      ms: Date.now() - startTime,
    }, "Enhancement chain completed");
  } catch (err) {
    logger.error({ err, jobId: body.jobId }, "Enhancement chain failed");
    await db.update(mediaJobsTable).set({
      status: "failed",
      processingTimeMs: Date.now() - startTime,
      errorMessage: err instanceof Error ? err.message : "Enhancement chain failed",
    }).where(eq(mediaJobsTable.id, body.jobId));
  }
});

// ─── Batch Enhancement ─────────────────────────────────────────
// POST /media/enhance-batch — process multiple images in one call (tier-aware limits)
router.post("/media/enhance-batch", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { jobIds, enhancementType, settings } = req.body as {
    jobIds?: number[];
    enhancementType?: string;
    settings?: Record<string, unknown>;
  };

  if (!jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
    res.status(400).json({ error: "jobIds array is required" });
    return;
  }
  if (!enhancementType) {
    res.status(400).json({ error: "enhancementType is required" });
    return;
  }

  await downgradeExpiredSubscription(req.userId!);

  let maxAllowed = 10;
  if (!isAdmin(req)) {
    const [batchUser] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
    if (!batchUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    let planSlug: string | null = null;
    if (batchUser.planId) {
      const [plan] = await db.select({ slug: plansTable.slug }).from(plansTable).where(eq(plansTable.id, batchUser.planId));
      planSlug = plan?.slug ?? null;
    }
    const tierSlug = resolveEffectivePlanSlug(planSlug, {
      role: batchUser.role,
      planId: batchUser.planId,
      planExpiresAt: batchUser.planExpiresAt,
      premiumTrialEndsAt: batchUser.premiumTrialEndsAt,
    });
    const filterId = (settings as Record<string, unknown> | undefined)?.filterId as string | undefined;
    const filterName = filterId ?? ((settings as Record<string, unknown> | undefined)?.filterName as string | undefined);
    const tierError = checkTierAccess(tierSlug, enhancementType, filterName);
    if (tierError) {
      res.status(403).json({ error: tierError, code: "TIER_RESTRICTED" });
      return;
    }
    maxAllowed = maxBatchJobsForPlan(tierSlug);
    if (maxAllowed === 0) {
      res.status(403).json({ error: "Batch processing requires a paid plan or trial.", code: "TIER_RESTRICTED" });
      return;
    }
    if (jobIds.length > maxAllowed) {
      res.status(400).json({
        error: `Maximum ${maxAllowed} images per batch for your plan.`,
        code: "BATCH_LIMIT",
      });
      return;
    }
  } else if (jobIds.length > 10) {
    res.status(400).json({ error: "Maximum 10 images per batch" });
    return;
  }

  // Fetch all jobs
  const jobs = [];
  for (const id of jobIds) {
    const [job] = await db.select().from(mediaJobsTable)
      .where(and(eq(mediaJobsTable.id, id), eq(mediaJobsTable.userId, req.userId!)));
    if (!job || !job.base64Data) {
      res.status(404).json({ error: `Job ${id} not found or has no image data` });
      return;
    }
    jobs.push(job);
  }

  const startTime = Date.now();

  // Mark all as processing
  for (const job of jobs) {
    await db.update(mediaJobsTable)
      .set({ status: "processing", enhancementType })
      .where(eq(mediaJobsTable.id, job.id));
  }

  // Debit credits
  await db.update(usersTable)
    .set({
      creditsUsed: sql`${usersTable.creditsUsed} + ${jobs.length}`,
      dailyCreditsUsed: sql`${usersTable.dailyCreditsUsed} + ${jobs.length}`,
    })
    .where(eq(usersTable.id, req.userId!));

  res.json({ status: "processing", jobIds, count: jobs.length });

  // Background batch processing
  try {
    const images = jobs.map((job) => ({
      base64Data: job.base64Data!,
      enhancementType,
      settings,
    }));

    const results = await callBatchRestoration(images);

    // Save results
    for (let i = 0; i < jobs.length; i++) {
      const result = results[i];
      const completedAt = new Date();
      const referenceCode = buildMediaReferenceCode({
        jobId: jobs[i].id,
        enhancementType,
        completedAt,
        suffix: "",
      });
      await db.update(mediaJobsTable).set({
        status: "completed",
        processedUrl: result.base64,
        thumbnailUrl: result.base64,
        processingTimeMs: Date.now() - startTime,
        completedAt,
        referenceCode,
        errorMessage: null,
      }).where(eq(mediaJobsTable.id, jobs[i].id));
    }

    logger.info({ jobIds, type: enhancementType, count: jobs.length, ms: Date.now() - startTime }, "Batch enhancement completed");
  } catch (err) {
    logger.error({ err, jobIds }, "Batch enhancement failed");
    for (const job of jobs) {
      await db.update(mediaJobsTable).set({
        status: "failed",
        processingTimeMs: Date.now() - startTime,
        errorMessage: err instanceof Error ? err.message : "Batch enhancement failed",
      }).where(eq(mediaJobsTable.id, job.id));
    }
  }
});

export default router;
