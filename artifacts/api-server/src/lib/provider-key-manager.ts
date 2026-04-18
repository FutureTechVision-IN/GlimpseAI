import { logger } from "./logger";

// =============================================================================
// ProviderKeyManager — loads, validates, health-checks, and routes API keys
// =============================================================================

export interface ProviderKeyEntry {
  key: string;
  model: string;
  status: "active" | "inactive" | "degraded" | "validating";
  lastValidated: Date | null;
  lastUsed: Date | null;
  latencyMs: number | null;
  successCount: number;
  errorCount: number;
  consecutiveErrors: number;
  errorMessage: string | null;
}

export interface ProviderGroup {
  model: string;
  modelSlug: string;
  keys: ProviderKeyEntry[];
}

const SLUG_TO_MODEL: Record<string, string> = {
  STEPFUN_STEP_3_5_FLASH_FREE: "stepfun/step-3.5-flash:free",
  NVIDIA_NEMOTRON_3_SUPER_120B_A12B_FREE: "nvidia/nemotron-3-super-120b-a12b:free",
  NVIDIA_NEMOTRON_3_NANO_30B_A3B_FREE: "nvidia/nemotron-3-nano-30b-a3b:free",
  ZAI_GLM_4_5_AIR_FREE: "z-ai/glm-4.5-air:free",
};

const OPENROUTER_BASE = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const MAX_CONSECUTIVE_ERRORS = 3;

class ProviderKeyManager {
  private groups: Map<string, ProviderGroup> = new Map();
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  // ---- Loading ----

  loadFromEnv(): { totalKeys: number; totalModels: number } {
    this.groups.clear();
    let totalKeys = 0;

    for (const [slug, model] of Object.entries(SLUG_TO_MODEL)) {
      const envVar = `PROVIDER_KEYS_${slug}`;
      const raw = process.env[envVar];
      if (!raw) continue;

      const keys = raw.split(",").map((k) => k.trim()).filter((k) => k.length > 0);
      if (keys.length === 0) continue;

      const entries: ProviderKeyEntry[] = keys.map((key) => ({
        key,
        model,
        status: "validating" as const,
        lastValidated: null,
        lastUsed: null,
        latencyMs: null,
        successCount: 0,
        errorCount: 0,
        consecutiveErrors: 0,
        errorMessage: null,
      }));

      this.groups.set(model, { model, modelSlug: slug, keys: entries });
      totalKeys += keys.length;
    }

    logger.info({ totalKeys, totalModels: this.groups.size }, "Provider keys loaded from env");
    return { totalKeys, totalModels: this.groups.size };
  }

  loadBulkKeys(model: string, keys: string[]): number {
    const group = this.groups.get(model);
    const existingKeys = new Set(group?.keys.map((k) => k.key) ?? []);
    const newKeys = keys.filter((k) => k.trim().length > 0 && !existingKeys.has(k.trim()));

    const entries: ProviderKeyEntry[] = newKeys.map((key) => ({
      key: key.trim(),
      model,
      status: "validating" as const,
      lastValidated: null,
      lastUsed: null,
      latencyMs: null,
      successCount: 0,
      errorCount: 0,
      consecutiveErrors: 0,
      errorMessage: null,
    }));

    if (group) {
      group.keys.push(...entries);
    } else {
      const slug = Object.entries(SLUG_TO_MODEL).find(([, m]) => m === model)?.[0] ?? model;
      this.groups.set(model, { model, modelSlug: slug, keys: entries });
    }

    return entries.length;
  }

  // ---- Validation ----

  async validateKey(entry: ProviderKeyEntry): Promise<boolean> {
    const start = Date.now();
    try {
      const resp = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
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

      const latency = Date.now() - start;
      entry.latencyMs = latency;
      entry.lastValidated = new Date();

      if (resp.ok) {
        entry.status = "active";
        entry.consecutiveErrors = 0;
        entry.errorMessage = null;
        return true;
      }

      const body = await resp.text().catch(() => "");
      entry.errorMessage = `HTTP ${resp.status}: ${body.slice(0, 200)}`;

      if (resp.status === 401 || resp.status === 403) {
        entry.status = "inactive";
      } else if (resp.status === 429) {
        entry.status = "degraded";
        entry.errorMessage = "Rate limited";
      } else {
        entry.status = "degraded";
      }
      return false;
    } catch (err) {
      entry.latencyMs = Date.now() - start;
      entry.lastValidated = new Date();
      entry.status = "inactive";
      entry.errorMessage = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  async validateAll(): Promise<{ active: number; inactive: number; degraded: number }> {
    const allEntries = this.getAllEntries();
    await Promise.allSettled(allEntries.map((entry) => this.validateKey(entry)));

    let active = 0, inactive = 0, degraded = 0;
    for (const entry of allEntries) {
      if (entry.status === "active") active++;
      else if (entry.status === "degraded") degraded++;
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
    logger.info("Provider health check loop started");
  }

  stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  // ---- Key Selection (Shuffle Strategy) ----

  private shuffle<T>(arr: T[]): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * Pick the best active key for a model.
   * Strategy: shuffle active keys, then sort by lowest latency.
   * This balances load while preferring faster keys.
   */
  pickKey(model: string): ProviderKeyEntry | null {
    const group = this.groups.get(model);
    if (!group) return null;

    const active = group.keys.filter((k) => k.status === "active");
    if (active.length === 0) {
      const degraded = group.keys.filter((k) => k.status === "degraded");
      if (degraded.length === 0) return null;
      return this.shuffle(degraded)[0];
    }

    const shuffled = this.shuffle(active);
    shuffled.sort((a, b) => (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity));
    return shuffled[0];
  }

  /** Pick a random active key across ALL models. */
  pickAnyKey(): ProviderKeyEntry | null {
    const allActive = this.getAllEntries().filter((k) => k.status === "active");
    if (allActive.length === 0) return null;
    return this.shuffle(allActive)[0];
  }

  // ---- Usage Tracking ----

  recordSuccess(entry: ProviderKeyEntry, latencyMs: number): void {
    entry.successCount++;
    entry.consecutiveErrors = 0;
    entry.lastUsed = new Date();
    entry.latencyMs = latencyMs;
  }

  recordError(entry: ProviderKeyEntry, error: string): void {
    entry.errorCount++;
    entry.consecutiveErrors++;
    entry.lastUsed = new Date();
    entry.errorMessage = error;

    if (entry.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      entry.status = "degraded";
      logger.warn(
        { model: entry.model, keyPrefix: entry.key.slice(0, 12) + "..." },
        "Key degraded after consecutive errors"
      );
    }
  }

  // ---- Query / Status ----

  getAllEntries(): ProviderKeyEntry[] {
    return Array.from(this.groups.values()).flatMap((g) => g.keys);
  }

  getGroups(): ProviderGroup[] {
    return Array.from(this.groups.values());
  }

  getStatus(): {
    totalKeys: number;
    active: number;
    inactive: number;
    degraded: number;
    models: { model: string; active: number; total: number }[];
  } {
    const all = this.getAllEntries();
    const models = Array.from(this.groups.entries()).map(([model, group]) => ({
      model,
      active: group.keys.filter((k) => k.status === "active").length,
      total: group.keys.length,
    }));

    return {
      totalKeys: all.length,
      active: all.filter((k) => k.status === "active").length,
      inactive: all.filter((k) => k.status === "inactive").length,
      degraded: all.filter((k) => k.status === "degraded").length,
      models,
    };
  }

  /** Keys masked for safe API responses. */
  getSafeEntries(): Array<Omit<ProviderKeyEntry, "key"> & { keyPrefix: string }> {
    return this.getAllEntries().map((e) => ({
      keyPrefix: e.key.slice(0, 12) + "..." + e.key.slice(-4),
      model: e.model,
      status: e.status,
      lastValidated: e.lastValidated,
      lastUsed: e.lastUsed,
      latencyMs: e.latencyMs,
      successCount: e.successCount,
      errorCount: e.errorCount,
      consecutiveErrors: e.consecutiveErrors,
      errorMessage: e.errorMessage,
    }));
  }

  removeKey(model: string, keyPrefix: string): boolean {
    const group = this.groups.get(model);
    if (!group) return false;
    const prefix = keyPrefix.replace(/\.{3}.*$/, "");
    const idx = group.keys.findIndex((k) => k.key.startsWith(prefix));
    if (idx === -1) return false;
    group.keys.splice(idx, 1);
    return true;
  }

  setKeyStatus(model: string, keyPrefix: string, newStatus: "active" | "inactive"): boolean {
    const group = this.groups.get(model);
    if (!group) return false;
    const prefix = keyPrefix.replace(/\.{3}.*$/, "");
    const entry = group.keys.find((k) => k.key.startsWith(prefix));
    if (!entry) return false;
    entry.status = newStatus;
    return true;
  }

  getAvailableModels(): string[] {
    return Array.from(this.groups.keys());
  }
}

// Singleton
export const providerKeyManager = new ProviderKeyManager();
