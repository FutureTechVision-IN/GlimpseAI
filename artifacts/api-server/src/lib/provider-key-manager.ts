import { logger } from "./logger";
import { db, apiKeysTable, apiKeyDailyUsageTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

// =============================================================================
// ProviderKeyManager — DB-backed key management with tier routing
// =============================================================================

export interface KeyEntry {
  id: number;
  key: string;
  provider: "openrouter" | "gemini";
  model: string;
  tier: "free" | "premium";
  status: "active" | "inactive" | "degraded" | "validating";
  priority: number;
  group: "primary" | "standard" | "germany" | "gemini";
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
  OPENROUTER_ELEPHANT_ALPHA:   "openrouter/elephant-alpha",
  MOONSHOTAI_KIMI_K2_5:        "moonshotai/kimi-k2.5",
};

/** Standard tier: text/vision models, proven free-tier availability */
const STANDARD_MODELS: Record<string, string> = {
  STEPFUN_STEP_3_5_FLASH_FREE:              "stepfun/step-3.5-flash:free",
  NVIDIA_NEMOTRON_3_SUPER_120B_A12B_FREE:   "nvidia/nemotron-3-super-120b-a12b:free",
  NVIDIA_NEMOTRON_3_NANO_30B_A3B_FREE:      "nvidia/nemotron-3-nano-30b-a3b:free",
  ZAI_GLM_4_5_AIR_FREE:                    "z-ai/glm-4.5-air:free",
};

/** Combined map used when loading from env */
const SLUG_TO_MODEL: Record<string, string> = {
  ...PRIMARY_MODELS,
  ...STANDARD_MODELS,
};

/** Maps model ID → routing group (used by pickKeyForTier priority cascade) */
const MODEL_GROUP: Record<string, "primary" | "standard" | "germany"> = {};
for (const m of Object.values(PRIMARY_MODELS))  MODEL_GROUP[m] = "primary";
for (const m of Object.values(STANDARD_MODELS)) MODEL_GROUP[m] = "standard";

/** Models that support image/video analysis via vision API */
const VISION_CAPABLE_MODELS = new Set([
  "bytedance/seedance-2.0",
  "alibaba/wan-2.7",
  "openrouter/elephant-alpha",
  "moonshotai/kimi-k2.5",
  "stepfun/step-3.5-flash:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
]);

const OPENROUTER_BASE = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const GERMANY_OPENROUTER_BASE = process.env.GERMANY_OPENROUTER_BASE_URL ?? OPENROUTER_BASE;
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const MAX_CONSECUTIVE_ERRORS = 3;

/** Validates that a string looks like an OpenRouter or Gemini API key */
function isValidKeyFormat(k: string): boolean {
  const t = k.trim();
  return t.startsWith("sk-or-") || t.startsWith("AIza") || (t.startsWith("AQ.") && t.length > 20);
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

    // ── Germany OpenRouter fallback keys ─────────────────────────────────
    // Env: GERMANY_OPENROUTER_KEYS=sk-or-v1-xxx,sk-or-v1-yyy,...
    // These are dedicated higher-limit keys used only when primary keys degrade
    const germanyRaw = process.env.GERMANY_OPENROUTER_KEYS ?? "";
    const germanyModel = process.env.GERMANY_OPENROUTER_MODEL ?? "moonshotai/kimi-k2.5";
    const germanyKeys = germanyRaw.split(",").map((k) => k.trim()).filter(isValidKeyFormat);
    for (const key of germanyKeys) {
      await this.upsertKey(key, "openrouter", germanyModel, "premium", "germany");
      totalKeys++;
      models.add(germanyModel);
    }

    // ── Gemini keys (last-resort fallback, premium only) ─────────────────
    const geminiRaw = process.env.GEMINI_API_KEYS ?? "";
    const geminiKeys = geminiRaw.split(",").map((k) => k.trim()).filter(isValidKeyFormat);
    for (const key of geminiKeys) {
      await this.upsertKey(key, "gemini", "gemini-2.0-flash", "premium", "gemini");
      totalKeys++;
      models.add("gemini-2.0-flash");
    }

    logger.info({ totalKeys, totalModels: models.size }, "Provider keys loaded from env");
    return { totalKeys, totalModels: models.size };
  }

  private async upsertKey(
    key: string,
    provider: "openrouter" | "gemini",
    model: string,
    tier: "free" | "premium",
    group: "primary" | "standard" | "germany" | "gemini" = "standard",
  ): Promise<KeyEntry> {
    const keyHash = key.slice(-8);
    const keyPrefix = key.slice(0, 12);

    const [existing] = await db.select().from(apiKeysTable)
      .where(and(eq(apiKeysTable.keyHash, keyHash), eq(apiKeysTable.provider, provider)));

    let dbId: number;
    if (existing) {
      dbId = existing.id;
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
      // Update group if key was previously loaded without it
      const mem = this.keys.get(dbId)!;
      mem.group = group;
      return mem;
    }

    const priorityVal = group === "primary" ? 3 : group === "germany" ? 2 : group === "gemini" ? 1 : 2;
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
    provider: "openrouter" | "gemini",
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

    const group: "primary" | "standard" | "germany" = MODEL_GROUP[model] === "primary"
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
        resp = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${entry.key}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://glimpse.ai",
            "X-Title": "GlimpseAI",
          },
          body: JSON.stringify({
            model: entry.model,
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 1,
          }),
          signal: AbortSignal.timeout(15000),
        });
      } else {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${entry.key}`;
        resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: "hi" }] }],
            generationConfig: { maxOutputTokens: 1 },
          }),
          signal: AbortSignal.timeout(15000),
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
      entry.status = "inactive";
      entry.lastError = err instanceof Error ? err.message : String(err);
      await this.syncToDb(entry);
      return false;
    }
  }

  async validateAll(): Promise<{ active: number; inactive: number; degraded: number }> {
    const entries = Array.from(this.keys.values());
    await Promise.allSettled(entries.map((e) => this.validateKey(e)));

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
   *   2. Standard OpenRouter (Stepfun, NVIDIA, GLM)            — all tiers
   *   3. Germany OpenRouter keys (dedicated fallback)          — all tiers
   *   4. Gemini                                                — premium only
   *
   * Within each level: active > degraded, then pick lowest latency.
   */
  pickKeyForTier(userTier: "free" | "premium"): KeyEntry | null {
    const all = Array.from(this.keys.values());

    const tryGroup = (group: "primary" | "standard" | "germany" | "gemini"): KeyEntry | null => {
      const active = all.filter((k) => k.group === group && k.status === "active");
      if (active.length > 0) return this.pickBest(active);
      // Degrade-fallback: if all keys in this group are degraded, try them anyway
      const degraded = all.filter((k) => k.group === group && k.status === "degraded");
      if (degraded.length > 0) return this.pickBest(degraded);
      return null;
    };

    return (
      tryGroup("primary") ??
      tryGroup("standard") ??
      tryGroup("germany") ??
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
        const statusOrder = { active: 0, degraded: 1, validating: 2, inactive: 3 };
        return (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
      })
      .map((e) => ({
        id: e.id,
        keyPrefix: e.key.slice(0, 12) + "..." + e.key.slice(-4),
        provider: e.provider,
        model: e.model,
        tier: e.tier,
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

  getAvailableModels(): string[] {
    return [...new Set(Array.from(this.keys.values()).map((k) => k.model))];
  }

  getKeyById(id: number): KeyEntry | undefined {
    return this.keys.get(id);
  }
}

// Singleton
export const providerKeyManager = new ProviderKeyManager();
