import { logger } from "./logger";

export interface RestorationHealth {
  status?: string;
  device?: string;
  gpu_available?: boolean;
  models_dir?: string;
  models_available?: Record<string, boolean>;
  capabilities?: string[];
  cache_stats?: Record<string, unknown>;
}

interface HealthCache {
  ok: boolean;
  health: RestorationHealth | null;
  expiresAt: number;
}

const DEFAULT_RESTORATION_PORT = process.env.RESTORATION_PORT || "7860";
const DEFAULT_RESTORATION_SERVICE_URL = `http://localhost:${DEFAULT_RESTORATION_PORT}`;
const HEALTH_CACHE_TTL_MS = 10_000;

let healthCache: HealthCache = { ok: false, health: null, expiresAt: 0 };
let sharedDispatcher: unknown | undefined;

function normaliseBaseUrl(raw: string | undefined): string {
  return (raw || DEFAULT_RESTORATION_SERVICE_URL).replace(/\/+$/, "");
}

export function getRestorationServiceUrl(): string {
  return normaliseBaseUrl(process.env.RESTORATION_SERVICE_URL);
}

export function getRedactedRestorationServiceUrl(): string {
  try {
    const url = new URL(getRestorationServiceUrl());
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "<invalid-restoration-url>";
  }
}

function getRestorationAuthHeaders(): Record<string, string> {
  const token = process.env.RESTORATION_SERVICE_TOKEN?.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getSharedDispatcher(): Promise<unknown | undefined> {
  if (sharedDispatcher) return sharedDispatcher;
  try {
    const moduleName = "undici";
    const undici = await import(moduleName);
    sharedDispatcher = new undici.Agent({
      headersTimeout: 15 * 60 * 1000,
      bodyTimeout: 15 * 60 * 1000,
      connectTimeout: 10_000,
      keepAliveTimeout: 60_000,
      keepAliveMaxTimeout: 600_000,
      connections: 4,
    });
  } catch {
    // undici is optional in dev/test; native fetch still works without it.
  }
  return sharedDispatcher;
}

export function invalidateRestorationHealthCache(): void {
  healthCache = { ok: false, health: null, expiresAt: 0 };
}

export async function fetchRestorationService(
  path: string,
  init: RequestInit = {},
  options: { timeoutMs?: number } = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 12_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const dispatcher = await getSharedDispatcher();
  const url = `${getRestorationServiceUrl()}${path.startsWith("/") ? path : `/${path}`}`;

  try {
    return await fetch(url, {
      ...init,
      signal: init.signal ?? controller.signal,
      headers: {
        ...getRestorationAuthHeaders(),
        ...(init.headers as Record<string, string> | undefined),
      },
      ...(dispatcher ? { dispatcher } : {}),
    } as RequestInit & { dispatcher?: unknown });
  } finally {
    clearTimeout(timer);
  }
}

export async function getRestorationHealth(force = false): Promise<{ ok: boolean; health: RestorationHealth | null }> {
  const now = Date.now();
  if (!force && now < healthCache.expiresAt) {
    return { ok: healthCache.ok, health: healthCache.health };
  }

  try {
    const res = await fetchRestorationService("/health", { method: "GET" }, { timeoutMs: 5_000 });
    const health = (await res.json().catch(() => null)) as RestorationHealth | null;
    healthCache = {
      ok: res.ok,
      health,
      expiresAt: now + HEALTH_CACHE_TTL_MS,
    };
    logger.debug({
      serviceUrl: getRedactedRestorationServiceUrl(),
      ok: res.ok,
      status: res.status,
      capabilities: health?.capabilities ?? [],
      tokenConfigured: Boolean(process.env.RESTORATION_SERVICE_TOKEN),
    }, "Restoration service health probe complete");
    return { ok: healthCache.ok, health: healthCache.health };
  } catch (err) {
    healthCache = { ok: false, health: null, expiresAt: now + HEALTH_CACHE_TTL_MS };
    logger.warn({
      serviceUrl: getRedactedRestorationServiceUrl(),
      err: err instanceof Error ? err.message : String(err),
      tokenConfigured: Boolean(process.env.RESTORATION_SERVICE_TOKEN),
    }, "Restoration service health probe failed");
    return { ok: false, health: null };
  }
}

export async function isRestorationServiceAvailable(requiredCapabilities: string[] = []): Promise<boolean> {
  const { ok, health } = await getRestorationHealth();
  if (!ok) return false;
  if (requiredCapabilities.length === 0) return true;
  const capabilities = new Set(health?.capabilities ?? []);
  return requiredCapabilities.every((capability) => capabilities.has(capability));
}
