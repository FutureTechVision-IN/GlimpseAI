import { logger } from "./logger";
import { db, apiKeysTable, apiKeyDailyUsageTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

// Fetch with manual AbortController to avoid Node.js undici "Headers Timeout Error"
function fetchWithTimeout(url: string, init: RequestInit & { timeout?: number }): Promise<Response> {
  const { timeout = 15000, ...fetchInit } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...fetchInit, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// =============================================================================
// ProviderKeyManager — DB-backed key management with tier routing
// =============================================================================

export interface KeyEntry {
  id: number;
  key: string;
  provider: "openrouter" | "gemini" | "nvidia";
  model: string;
  tier: "free" | "premium";
  status: "active" | "inactive" | "degraded" | "validating";
  priority: number;
  group: "primary" | "standard" | "gemini" | "nvidia";
  totalCalls: number;
  totalErrors: number;
  consecutiveErrors: number;
  lastUsedAt: Date | null;
  lastValidatedAt: Date | null;
  latencyMs: number | null;
  lastError: string | null;
}

// ---------------------------------------------------------------------------
// Model registry: env-var slug → OpenRouter model ID
// Grouped by capability tier for priority routing
// ---------------------------------------------------------------------------

/** Primary tier: high-quality vision/LLM models for image & video analysis */
const PRIMARY_MODELS: Record<string, string> = {
  // NEW — video-capable models (also support text/vision analysis)
  BYTEDANCE_SEEDANCE_2_0:      "bytedance/seedance-2.0",
  ALIBABA_WAN_2_7:             "alibaba/wan-2.7",
  INCLUSIONAI_LING_2_6_FLASH_FREE: "inclusionai/ling-2.6-flash:free",
  MOONSHOTAI_KIMI_K2_5:        "moonshotai/kimi-k2.5",
};

/** Standard tier: text/vision models, proven free-tier availability */
const STANDARD_MODELS: Record<string, string> = {
  STEPFUN_STEP_3_5_FLASH_FREE:              "stepfun/step-3.5-flash:free",
  NVIDIA_NEMOTRON_3_SUPER_120B_A12B_FREE:   "nvidia/nemotron-3-super-120b-a12b:free",
  NVIDIA_NEMOTRON_3_NANO_30B_A3B_FREE:      "nvidia/nemotron-3-nano-30b-a3b:free",
  ZAI_GLM_4_5_AIR_FREE:                    "z-ai/glm-4.5-air:free",
  OPENAI_GPT_OSS_120B_FREE:                "openai/gpt-oss-120b:free",
};

/** Combined map used when loading from env */
const SLUG_TO_MODEL: Record<string, string> = {
  ...PRIMARY_MODELS,
  ...STANDARD_MODELS,
};

/** Maps model ID → routing group (used by pickKeyForTier priority cascade) */
const MODEL_GROUP: Record<string, "primary" | "standard"> = {};
for (const m of Object.values(PRIMARY_MODELS))  MODEL_GROUP[m] = "primary";
for (const m of Object.values(STANDARD_MODELS)) MODEL_GROUP[m] = "standard";

/** NVIDIA direct API models — keyed separately from OpenRouter with nvapi- keys */
const NVIDIA_DIRECT_MODELS: Record<string, { visionCapable: boolean; maxTokens: number }> = {
  "moonshotai/kimi-k2.5": { visionCapable: true, maxTokens: 16384 },
  "minimaxai/minimax-m2.5": { visionCapable: false, maxTokens: 8192 },
  "nvidia/nemotron-3-super-120b-a12b": { visionCapable: false, maxTokens: 16384 },
};

/** Models that support image/video analysis via vision API */
const VISION_CAPABLE_MODELS = new Set([
  "bytedance/seedance-2.0",
  "alibaba/wan-2.7",
  "inclusionai/ling-2.6-flash:free",
  "moonshotai/kimi-k2.5",
  "stepfun/step-3.5-flash:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
]);

const OPENROUTER_BASE = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const MAX_CONSECUTIVE_ERRORS = 3;

/** Validates that a string looks like an OpenRouter, Gemini, or NVIDIA API key */
function isValidKeyFormat(k: string): boolean {
  const t = k.trim();
  return t.startsWith("sk-or-") || t.startsWith("AIza") || (t.startsWith("AQ.") && t.length > 20) || t.startsWith("nvapi-");
}

class ProviderKeyManager {
  private keys: Map<number, KeyEntry> = new Map();
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  // ---- Loading ----

  async loadFromEnv(): Promise<{ totalKeys: number; totalModels: number }> {
    let totalKeys = 0;
    const models = new Set<string>();

    // ── Primary + standard OpenRouter keys ───────────────────────────────
    for (const [slug, model] of Object.entries(SLUG_TO_MODEL)) {
      const envVar = `PROVIDER_KEYS_${slug}`;
      const raw = process.env[envVar];
      if (!raw) continue;

      const keyStrings = raw.split(",").map((k) => k.trim()).filter(isValidKeyFormat);
      if (keyStrings.length === 0) continue;
      models.add(model);

      const group = MODEL_GROUP[model] ?? "standard";
      const tier: "free" | "premium" = group === "primary" ? "premium" : "free";

      for (const key of keyStrings) {
        await this.upsertKey(key, "openrouter", model, tier, group);
        totalKeys++;
      }
    }

    // ── Gemini keys (last-resort fallback, premium only) ─────────────────
    const geminiRaw = process.env.GEMINI_API_KEYS ?? "";
    const geminiKeys = geminiRaw.split(",").map((k) => k.trim()).filter(isValidKeyFormat);
    for (const key of geminiKeys) {
      await this.upsertKey(key, "gemini", "gemini-2.0-flash", "premium", "gemini");
      totalKeys++;
      models.add("gemini-2.0-flash");
    }

    // ── NVIDIA direct API keys (separate from OpenRouter) ───────────
    // Env: NVIDIA_API_KEY=nvapi-xxx (single key used for all NVIDIA-hosted models)
    const nvidiaKey = (process.env.NVIDIA_API_KEY ?? "").trim();
    if (nvidiaKey && nvidiaKey.startsWith("nvapi-")) {
      for (const modelId of Object.keys(NVIDIA_DIRECT_MODELS)) {
        await this.upsertKey(nvidiaKey, "nvidia", modelId, "premium", "nvidia");
        totalKeys++;
        models.add(modelId);
      }
    }

    logger.info({ totalKeys, totalModels: models.size }, "Provider keys loaded from env");
    return { totalKeys, totalModels: models.size };
  }

  private async upsertKey(
    key: string,
    provider: "openrouter" | "gemini" | "nvidia",
    model: string,
    tier: "free" | "premium",
    group: "primary" | "standard" | "gemini" | "nvidia" = "standard",
  ): Promise<KeyEntry> {
    const keyHash = key.slice(-8);
    const keyPrefix = key.slice(0, 12);

    // For non-NVIDIA providers, match by keyHash + provider (one key per model)
    // For NVIDIA, match by keyHash + provider + model (same key used for multiple models)
    const matchCondition = provider === "nvidia"
      ? and(eq(apiKeysTable.keyHash, keyHash), eq(apiKeysTable.provider, provider), eq(apiKeysTable.model, model))
      : and(eq(apiKeysTable.keyHash, keyHash), eq(apiKeysTable.provider, provider));

    const [existing] = await db.select().from(apiKeysTable).where(matchCondition);

    let dbId: number;
    if (existing) {
      dbId = existing.id;

      // Sync model in DB if it changed (e.g. model renamed upstream like elephant-alpha → ling)
      if (existing.model !== model) {
        await db.update(apiKeysTable).set({ model }).where(eq(apiKeysTable.id, dbId)).catch(() => {});
        logger.info({ oldModel: existing.model, newModel: model, keyPrefix }, "Migrated key to updated model");
      }

      if (!this.keys.has(dbId)) {
        const entry: KeyEntry = {
          id: dbId,
          key,
          provider,
          model,
          tier: existing.tier as "free" | "premium",
          status: existing.status as KeyEntry["status"],
          priority: existing.priority,
          totalCalls: existing.totalCalls,
          totalErrors: existing.totalErrors,
          consecutiveErrors: 0,
          lastUsedAt: existing.lastUsedAt,
          lastValidatedAt: existing.lastValidatedAt,
          latencyMs: existing.latencyMs,
          lastError: existing.lastError,
          group,
        };
        this.keys.set(dbId, entry);
        return entry;
      }
      // Update group + model if key was previously loaded with stale values
      const mem = this.keys.get(dbId)!;
      mem.group = group;
      mem.model = model;
      return mem;
    }

    const priorityVal = group === "primary" ? 3 : group === "gemini" ? 1 : group === "nvidia" ? 2 : 2;
    const [inserted] = await db.insert(apiKeysTable).values({
      provider,
      model,
      keyHash,
      keyPrefix,
      tier,
      status: "validating",
      priority: priorityVal,
    }).returning();

    dbId = inserted.id;
    const entry: KeyEntry = {
      id: dbId,
      key,
      provider,
      model,
      tier,
      status: "validating",
      priority: priorityVal,
      totalCalls: 0,
      totalErrors: 0,
      consecutiveErrors: 0,
      lastUsedAt: null,
      lastValidatedAt: null,
      latencyMs: null,
      lastError: null,
      group,
    };
    this.keys.set(dbId, entry);
    return entry;
  }

  async loadBulkKeys(
    keys: string[],
    provider: "openrouter" | "gemini" | "nvidia",
    model: string,
    tier: "free" | "premium",
  ): Promise<number> {
    let added = 0;
    const existingHashes = new Set(
      Array.from(this.keys.values()).map((k) => k.key.slice(-8))
    );

    // FIX: Tokenize each entry by whitespace so space-separated pastes work.
    // Also filter out non-key tokens (model names, labels, blank lines).
    const tokens: string[] = [];
    for (const raw of keys) {
      // Split each element by whitespace and collect valid-looking keys
      for (const token of raw.split(/\s+/)) {
        const t = token.trim();
        if (isValidKeyFormat(t)) tokens.push(t);
      }
    }

    const group: "primary" | "standard" = MODEL_GROUP[model] === "primary"
      ? "primary"
      : "standard";

    for (const key of tokens) {
      if (existingHashes.has(key.slice(-8))) continue;
      await this.upsertKey(key, provider, model, tier, group);
      existingHashes.add(key.slice(-8)); // prevent in-batch duplicates
      added++;
    }

    logger.info({ model, provider, tier, requested: keys.length, tokensFound: tokens.length, added }, "Bulk key import complete");
    return added;
  }

  // ---- Validation ----

  async validateKey(entry: KeyEntry): Promise<boolean> {
    const start = Date.now();
    entry.status = "validating";

    try {
      let resp: Response;

      if (entry.provider === "openrouter") {
        // Lightweight: /auth/key just checks key validity, no model call or rate-limit cost
        resp = await fetchWithTimeout(`${OPENROUTER_BASE}/auth/key`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${entry.key}`,
          },
          timeout: 10000,
        });
      } else if (entry.provider === "nvidia") {
        resp = await fetchWithTimeout(`${NVIDIA_BASE}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${entry.key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: entry.model,
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 1,
          }),
          timeout: 25000,
        });
      } else {
        // Gemini: lightweight model list check — no generation, no RPM cost
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${entry.key}&pageSize=1`;
        resp = await fetchWithTimeout(url, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          timeout: 10000,
        });
      }

      const latency = Date.now() - start;
      entry.latencyMs = latency;
      entry.lastValidatedAt = new Date();

      if (resp.ok) {
        entry.status = "active";
        entry.consecutiveErrors = 0;
        entry.lastError = null;
        await this.syncToDb(entry);
        return true;
      }

      const body = await resp.text().catch(() => "");
      entry.lastError = `HTTP ${resp.status}: ${body.slice(0, 200)}`;

      if (resp.status === 401 || resp.status === 403) {
        entry.status = "inactive";
      } else if (resp.status === 429) {
        entry.status = "degraded";
        entry.lastError = "Rate limited";
      } else {
        entry.status = "degraded";
      }
      await this.syncToDb(entry);
      return false;
    } catch (err) {
      entry.latencyMs = Date.now() - start;
      entry.lastValidatedAt = new Date();
      // Network errors / timeouts are temporary — mark as degraded, not inactive
      entry.status = "degraded";
      entry.lastError = err instanceof Error ? err.message : String(err);
      await this.syncToDb(entry);
      return false;
    }
  }

  async validateAll(): Promise<{ active: number; inactive: number; degraded: number }> {
    const entries = Array.from(this.keys.values());

    // Group by provider and stagger to avoid rate-limit stampedes
    const byProvider = new Map<string, KeyEntry[]>();
    for (const e of entries) {
      const list = byProvider.get(e.provider) ?? [];
      list.push(e);
      byProvider.set(e.provider, list);
    }

    // Validate each provider group with mild stagger (lightweight endpoints, low rate-limit risk)
    // OpenRouter /auth/key and Gemini /models are metadata endpoints, not generation calls
    const validateGroup = async (group: KeyEntry[]) => {
      const batchSize = 3;
      const delayMs = 500;
      for (let i = 0; i < group.length; i += batchSize) {
        const batch = group.slice(i, i + batchSize);
        await Promise.allSettled(batch.map(e => this.validateKey(e)));
        if (i + batchSize < group.length) {
          await new Promise(r => setTimeout(r, delayMs));
        }
      }
    };

    // Run provider groups in parallel (different APIs won't conflict)
    await Promise.allSettled(
      Array.from(byProvider.values()).map(group => validateGroup(group))
    );

    let active = 0, inactive = 0, degraded = 0;
    for (const e of entries) {
      if (e.status === "active") active++;
      else if (e.status === "degraded") degraded++;
      else inactive++;
    }

    logger.info({ active, inactive, degraded }, "Provider key validation complete");
    return { active, inactive, degraded };
  }

  // ---- Health Check Loop ----

  startHealthChecks(): void {
    if (this.healthCheckTimer) return;
    this.healthCheckTimer = setInterval(() => {
      this.validateAll().catch((err) => logger.error({ err }, "Health check cycle failed"));
    }, HEALTH_CHECK_INTERVAL_MS);
    logger.info("Provider health check loop started (5min interval)");
  }

  stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  // ---- Key Selection ----

  private shuffle<T>(arr: T[]): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i]!, result[j]!] = [result[j]!, result[i]!];
    }
    return result;
  }

  /**
   * Tier-based key selection with 4-level priority cascade:
   *   1. Primary OpenRouter (Seedance, WAN, Kimi, Elephant)   — all tiers
   *   2. NVIDIA direct (Kimi-K2.5, MiniMax-M2.5, Nemotron)   — all tiers
   *   3. Standard OpenRouter (Stepfun, NVIDIA, GLM)            — all tiers
   *   4. Gemini                                                — premium only
   *
   * Within each level: active > degraded, then pick lowest latency.
   */
  pickKeyForTier(userTier: "free" | "premium"): KeyEntry | null {
    const all = Array.from(this.keys.values());

    const tryGroup = (group: "primary" | "standard" | "gemini" | "nvidia"): KeyEntry | null => {
      const active = all.filter((k) => k.group === group && k.status === "active");
      if (active.length > 0) return this.pickBest(active);
      // Degrade-fallback: if all keys in this group are degraded, try them anyway
      const degraded = all.filter((k) => k.group === group && k.status === "degraded");
      if (degraded.length > 0) return this.pickBest(degraded);
      return null;
    };

    return (
      tryGroup("primary") ??
      tryGroup("nvidia") ??
      tryGroup("standard") ??
      // Gemini is reserved: premium users only, last resort
      (userTier === "premium" ? tryGroup("gemini") : null)
    );
  }

  pickKey(model: string): KeyEntry | null {
    const active = Array.from(this.keys.values())
      .filter((k) => k.model === model && k.status === "active");
    if (active.length > 0) return this.pickBest(active);

    const degraded = Array.from(this.keys.values())
      .filter((k) => k.model === model && k.status === "degraded");
    return this.pickBest(degraded);
  }

  pickAnyKey(): KeyEntry | null {
    const active = Array.from(this.keys.values()).filter((k) => k.status === "active");
    return this.pickBest(active);
  }

  private pickBest(candidates: KeyEntry[]): KeyEntry | null {
    if (candidates.length === 0) return null;
    const shuffled = this.shuffle(candidates);
    shuffled.sort((a, b) => (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity));
    return shuffled[0]!;
  }

  // ---- Usage Tracking ----

  async recordSuccess(entry: KeyEntry, latencyMs: number): Promise<void> {
    entry.totalCalls++;
    entry.consecutiveErrors = 0;
    entry.lastUsedAt = new Date();
    entry.latencyMs = latencyMs;

    await this.syncToDb(entry);
    await this.recordDailyUsage(entry.id, true, latencyMs);
  }

  async recordError(entry: KeyEntry, error: string): Promise<void> {
    entry.totalErrors++;
    entry.totalCalls++;
    entry.consecutiveErrors++;
    entry.lastUsedAt = new Date();
    entry.lastError = error;

    if (entry.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      entry.status = "degraded";
      logger.warn(
        { provider: entry.provider, model: entry.model, keyPrefix: entry.key.slice(0, 12) + "..." },
        "Key degraded after consecutive errors"
      );
    }

    await this.syncToDb(entry);
    await this.recordDailyUsage(entry.id, false, null);
  }

  private async recordDailyUsage(apiKeyId: number, success: boolean, latencyMs: number | null): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const [existing] = await db.select().from(apiKeyDailyUsageTable)
        .where(and(
          eq(apiKeyDailyUsageTable.apiKeyId, apiKeyId),
          eq(apiKeyDailyUsageTable.date, today),
        ));

      if (existing) {
        const newCallCount = existing.callCount + 1;
        const newErrorCount = existing.errorCount + (success ? 0 : 1);
        const newAvg = latencyMs != null && existing.avgLatencyMs != null
          ? Math.round((existing.avgLatencyMs * existing.callCount + latencyMs) / newCallCount)
          : latencyMs ?? existing.avgLatencyMs;

        await db.update(apiKeyDailyUsageTable)
          .set({ callCount: newCallCount, errorCount: newErrorCount, avgLatencyMs: newAvg })
          .where(eq(apiKeyDailyUsageTable.id, existing.id));
      } else {
        await db.insert(apiKeyDailyUsageTable).values({
          apiKeyId,
          date: today,
          callCount: 1,
          errorCount: success ? 0 : 1,
          avgLatencyMs: latencyMs,
        });
      }
    } catch (err) {
      logger.debug({ err }, "Failed to record daily usage (non-fatal)");
    }
  }

  private async syncToDb(entry: KeyEntry): Promise<void> {
    try {
      await db.update(apiKeysTable)
        .set({
          model: entry.model,
          status: entry.status,
          totalCalls: entry.totalCalls,
          totalErrors: entry.totalErrors,
          lastUsedAt: entry.lastUsedAt,
          lastValidatedAt: entry.lastValidatedAt,
          lastError: entry.lastError,
          latencyMs: entry.latencyMs,
        })
        .where(eq(apiKeysTable.id, entry.id));
    } catch (err) {
      logger.debug({ err }, "Failed to sync key to DB (non-fatal)");
    }
  }

  // ---- Query / Status ----

  getAllEntries(): KeyEntry[] {
    return Array.from(this.keys.values());
  }

  getStatus(): {
    totalKeys: number;
    active: number;
    inactive: number;
    degraded: number;
    byProvider: { provider: string; active: number; total: number; totalCalls: number }[];
    byTier: { tier: string; active: number; total: number }[];
  } {
    const all = Array.from(this.keys.values());
    const providerMap = new Map<string, { active: number; total: number; totalCalls: number }>();
    const tierMap = new Map<string, { active: number; total: number }>();

    for (const k of all) {
      const p = providerMap.get(k.provider) ?? { active: 0, total: 0, totalCalls: 0 };
      p.total++;
      p.totalCalls += k.totalCalls;
      if (k.status === "active") p.active++;
      providerMap.set(k.provider, p);

      const t = tierMap.get(k.tier) ?? { active: 0, total: 0 };
      t.total++;
      if (k.status === "active") t.active++;
      tierMap.set(k.tier, t);
    }

    return {
      totalKeys: all.length,
      active: all.filter((k) => k.status === "active").length,
      inactive: all.filter((k) => k.status === "inactive").length,
      degraded: all.filter((k) => k.status === "degraded").length,
      byProvider: Array.from(providerMap.entries()).map(([provider, s]) => ({ provider, ...s })),
      byTier: Array.from(tierMap.entries()).map(([tier, s]) => ({ tier, ...s })),
    };
  }

  getSafeEntries(): Array<Omit<KeyEntry, "key"> & { keyPrefix: string }> {
    return Array.from(this.keys.values())
      .sort((a, b) => {
        const groupOrder = { primary: 0, nvidia: 1, standard: 2, gemini: 3 };
        const statusOrder = { active: 0, degraded: 1, validating: 2, inactive: 3 };
        const gDiff = (groupOrder[a.group] ?? 4) - (groupOrder[b.group] ?? 4);
        if (gDiff !== 0) return gDiff;
        return (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
      })
      .map((e) => ({
        id: e.id,
        keyPrefix: e.key.slice(0, 12) + "..." + e.key.slice(-4),
        provider: e.provider,
        model: e.model,
        tier: e.tier,
        group: e.group,
        status: e.status,
        priority: e.priority,
        totalCalls: e.totalCalls,
        totalErrors: e.totalErrors,
        consecutiveErrors: e.consecutiveErrors,
        lastUsedAt: e.lastUsedAt,
        lastValidatedAt: e.lastValidatedAt,
        latencyMs: e.latencyMs,
        lastError: e.lastError,
      }));
  }

  async removeKey(keyId: number): Promise<boolean> {
    const entry = this.keys.get(keyId);
    if (!entry) return false;
    this.keys.delete(keyId);
    await db.delete(apiKeysTable).where(eq(apiKeysTable.id, keyId)).catch(() => {});
    return true;
  }

  async setKeyStatus(keyId: number, newStatus: "active" | "inactive"): Promise<boolean> {
    const entry = this.keys.get(keyId);
    if (!entry) return false;
    entry.status = newStatus;
    await this.syncToDb(entry);
    return true;
  }

  async setKeyTier(keyId: number, tier: "free" | "premium"): Promise<boolean> {
    const entry = this.keys.get(keyId);
    if (!entry) return false;
    entry.tier = tier;
    await db.update(apiKeysTable).set({ tier }).where(eq(apiKeysTable.id, keyId)).catch(() => {});
    return true;
  }

  getUsageReport(): {
    summary: { totalKeys: number; activeKeys: number; degradedKeys: number; unusedKeys: number; totalCalls: number; totalErrors: number };
    byGroup: { group: string; total: number; active: number; degraded: number; totalCalls: number; usageRate: string }[];
    byModel: { model: string; total: number; active: number; totalCalls: number }[];
    unusedKeys: { keyPrefix: string; provider: string; model: string; group: string; status: string }[];
    recommendations: string[];
  } {
    const all = Array.from(this.keys.values());
    const totalCalls = all.reduce((s, k) => s + k.totalCalls, 0);
    const totalErrors = all.reduce((s, k) => s + k.totalErrors, 0);
    const unusedKeys = all.filter((k) => k.totalCalls === 0);

    // By group
    const groupMap = new Map<string, { total: number; active: number; degraded: number; calls: number }>();
    for (const k of all) {
      const g = groupMap.get(k.group) ?? { total: 0, active: 0, degraded: 0, calls: 0 };
      g.total++;
      g.calls += k.totalCalls;
      if (k.status === "active") g.active++;
      if (k.status === "degraded") g.degraded++;
      groupMap.set(k.group, g);
    }

    // By model
    const modelMap = new Map<string, { total: number; active: number; calls: number }>();
    for (const k of all) {
      const m = modelMap.get(k.model) ?? { total: 0, active: 0, calls: 0 };
      m.total++;
      m.calls += k.totalCalls;
      if (k.status === "active") m.active++;
      modelMap.set(k.model, m);
    }

    // Recommendations
    const recs: string[] = [];
    const primaryGroup = groupMap.get("primary");
    if (!primaryGroup || primaryGroup.active === 0) {
      recs.push("⚠️ No primary-group keys are active — run Load from Env and Validate All.");
    }
    if (unusedKeys.length > 0) {
      recs.push(`🔑 ${unusedKeys.length} key(s) have never been used — validate and activate them.`);
    }
    const errorRate = totalCalls > 0 ? totalErrors / totalCalls : 0;
    if (errorRate > 0.2) recs.push(`⚠️ High error rate (${Math.round(errorRate * 100)}%) — review degraded keys.`);
    if (recs.length === 0) recs.push("✅ Key pool is healthy. All tiers configured and active.");

    return {
      summary: {
        totalKeys: all.length,
        activeKeys: all.filter((k) => k.status === "active").length,
        degradedKeys: all.filter((k) => k.status === "degraded").length,
        unusedKeys: unusedKeys.length,
        totalCalls,
        totalErrors,
      },
      byGroup: Array.from(groupMap.entries()).map(([group, s]) => ({
        group,
        total: s.total,
        active: s.active,
        degraded: s.degraded,
        totalCalls: s.calls,
        usageRate: s.total > 0 ? `${Math.round((s.active / s.total) * 100)}% active` : "0%",
      })),
      byModel: Array.from(modelMap.entries()).map(([model, s]) => ({
        model,
        total: s.total,
        active: s.active,
        totalCalls: s.calls,
      })),
      unusedKeys: unusedKeys.map((k) => ({
        keyPrefix: k.key.slice(0, 12) + "..." + k.key.slice(-4),
        provider: k.provider,
        model: k.model,
        group: k.group,
        status: k.status,
      })),
      recommendations: recs,
    };
  }

  getAvailableModels(): { id: string; group: string; visionCapable: boolean }[] {
    const seen = new Set<string>();
    const result: { id: string; group: string; visionCapable: boolean }[] = [];
    for (const m of Object.values(PRIMARY_MODELS)) {
      if (!seen.has(m)) { seen.add(m); result.push({ id: m, group: "primary", visionCapable: VISION_CAPABLE_MODELS.has(m) }); }
    }
    for (const m of Object.values(STANDARD_MODELS)) {
      if (!seen.has(m)) { seen.add(m); result.push({ id: m, group: "standard", visionCapable: VISION_CAPABLE_MODELS.has(m) }); }
    }
    result.push({ id: "gemini-2.0-flash", group: "gemini", visionCapable: true });
    for (const [modelId, meta] of Object.entries(NVIDIA_DIRECT_MODELS)) {
      if (!seen.has(modelId)) { seen.add(modelId); result.push({ id: modelId, group: "nvidia", visionCapable: meta.visionCapable }); }
    }
    return result;
  }

  getAvailableModelIds(): string[] {
    return this.getAvailableModels().map((m) => m.id);
  }

  getKeyById(id: number): KeyEntry | undefined {
    return this.keys.get(id);
  }
}

// Singleton
export const providerKeyManager = new ProviderKeyManager();
