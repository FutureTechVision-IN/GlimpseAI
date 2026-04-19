/**
 * demo-api.ts — Fetch interceptor for GitHub Pages demo mode.
 * Activated when VITE_DEMO_MODE=true is set at build time.
 * Intercepts all /api calls and returns realistic mock data so the
 * app is fully interactive on static hosting.
 */

const DEMO_TOKEN = "demo-token-glimpse-ai-gh-pages-2026";
const DEMO_USER = {
  id: 1,
  name: "Alex Morgan",
  email: "admin@glimpse.ai",
  role: "admin",
  planId: 3,
  creditsUsed: 142,
  creditsLimit: 600,
  isSuspended: false,
  createdAt: "2026-01-15T09:00:00Z",
};

const DEMO_USAGE = {
  creditsUsed: 142,
  creditsLimit: 600,
  creditsRemaining: 458,
  dailyCreditsUsed: 7,
  dailyLimit: 20,
  dailyRemaining: 13,
  planName: "Premium",
  planExpiry: "2026-12-31T23:59:59Z",
  photoCount: 98,
  videoCount: 44,
  totalJobs: 142,
};

const DEMO_JOBS = [
  {
    id: 101,
    userId: 1,
    mediaType: "photo",
    status: "completed",
    filename: "sunset_landscape.jpg",
    originalUrl: null,
    processedUrl: null,
    thumbnailUrl: null,
    enhancementType: "auto",
    presetId: null,
    errorMessage: null,
    processingTimeMs: 1842,
    fileSize: 2457600,
    createdAt: "2026-04-17T14:32:00Z",
    completedAt: "2026-04-17T14:32:01Z",
  },
  {
    id: 100,
    userId: 1,
    mediaType: "photo",
    status: "completed",
    filename: "portrait_studio.png",
    originalUrl: null,
    processedUrl: null,
    thumbnailUrl: null,
    enhancementType: "portrait",
    presetId: null,
    errorMessage: null,
    processingTimeMs: 2103,
    fileSize: 3145728,
    createdAt: "2026-04-16T11:15:00Z",
    completedAt: "2026-04-16T11:15:02Z",
  },
  {
    id: 99,
    userId: 1,
    mediaType: "video",
    status: "completed",
    filename: "travel_clip_tokyo.mp4",
    originalUrl: null,
    processedUrl: null,
    thumbnailUrl: null,
    enhancementType: "cinematic",
    presetId: null,
    errorMessage: null,
    processingTimeMs: 12400,
    fileSize: 52428800,
    createdAt: "2026-04-15T18:00:00Z",
    completedAt: "2026-04-15T18:00:12Z",
  },
  {
    id: 98,
    userId: 1,
    mediaType: "photo",
    status: "completed",
    filename: "product_shot_watch.jpg",
    originalUrl: null,
    processedUrl: null,
    thumbnailUrl: null,
    enhancementType: "hdr",
    presetId: null,
    errorMessage: null,
    processingTimeMs: 1654,
    fileSize: 1887436,
    createdAt: "2026-04-14T10:45:00Z",
    completedAt: "2026-04-14T10:45:01Z",
  },
  {
    id: 97,
    userId: 1,
    mediaType: "photo",
    status: "failed",
    filename: "raw_capture_dng.dng",
    originalUrl: null,
    processedUrl: null,
    thumbnailUrl: null,
    enhancementType: "auto",
    presetId: null,
    errorMessage: "Unsupported file format",
    processingTimeMs: null,
    fileSize: 24117248,
    createdAt: "2026-04-13T09:20:00Z",
    completedAt: null,
  },
];

const DEMO_PLANS = [
  {
    id: 1,
    name: "Free",
    slug: "free",
    description: "Try GlimpseAI with 5 free enhancements",
    priceMonthly: 0,
    priceAnnual: 0,
    creditsPerMonth: 5,
    features: ["5 free enhancements", "Photo enhancement", "Basic AI filters", "Standard quality"],
    isActive: true,
    isPopular: false,
  },
  {
    id: 2,
    name: "Basic",
    slug: "basic",
    description: "For regular creators who need consistent quality",
    priceMonthly: 46100,
    priceAnnual: 461200,
    creditsPerMonth: 600,
    features: ["20 enhancements/day", "600 enhancements/month", "Photo & video enhancement", "AI-powered filters", "HD quality output", "Email support"],
    isActive: true,
    isPopular: false,
  },
  {
    id: 3,
    name: "Premium",
    slug: "premium",
    description: "Unlock every feature for professional-grade results",
    priceMonthly: 92400,
    priceAnnual: 924000,
    creditsPerMonth: 600,
    features: ["20 enhancements/day", "600 enhancements/month", "Photo & video enhancement", "4× upscaling", "Posture adjustment", "Fine-tuned edits", "Priority processing", "Priority support"],
    isActive: true,
    isPopular: true,
  },
];

const DEMO_ADMIN_USERS = [
  DEMO_USER,
  {
    id: 2, name: "Priya Sharma", email: "priya.sharma@example.com", role: "user",
    planId: 2, creditsUsed: 380, creditsLimit: 600, isSuspended: false,
    createdAt: "2026-02-10T08:30:00Z",
  },
  {
    id: 3, name: "Rahul Verma", email: "rahul.verma@example.com", role: "user",
    planId: 1, creditsUsed: 3, creditsLimit: 5, isSuspended: false,
    createdAt: "2026-03-05T14:20:00Z",
  },
  {
    id: 4, name: "Anika Patel", email: "anika.patel@example.com", role: "user",
    planId: 3, creditsUsed: 512, creditsLimit: 600, isSuspended: false,
    createdAt: "2026-03-22T11:00:00Z",
  },
  {
    id: 5, name: "Dev Kumar", email: "dev.kumar@example.com", role: "user",
    planId: null, creditsUsed: 0, creditsLimit: 5, isSuspended: true,
    createdAt: "2026-04-01T09:15:00Z",
  },
];

const DEMO_PAYMENTS = [
  { id: 1, userId: 1, planId: 3, amount: 924000, currency: "INR", status: "success", razorpayOrderId: "order_demo_001", razorpayPaymentId: null, billingPeriod: "annual", createdAt: "2026-01-15T09:05:00Z" },
  { id: 2, userId: 2, planId: 2, amount: 461200, currency: "INR", status: "success", razorpayOrderId: "order_demo_002", razorpayPaymentId: null, billingPeriod: "annual", createdAt: "2026-02-10T08:35:00Z" },
  { id: 3, userId: 4, planId: 3, amount: 924000, currency: "INR", status: "success", razorpayOrderId: "order_demo_003", razorpayPaymentId: null, billingPeriod: "annual", createdAt: "2026-03-22T11:05:00Z" },
  { id: 4, userId: 3, planId: 1, amount: 0, currency: "INR", status: "success", razorpayOrderId: null, razorpayPaymentId: null, billingPeriod: null, createdAt: "2026-03-05T14:25:00Z" },
  { id: 5, userId: 5, planId: 2, amount: 461200, currency: "INR", status: "failed", razorpayOrderId: "order_demo_005", razorpayPaymentId: null, billingPeriod: "annual", createdAt: "2026-04-01T09:20:00Z" },
];

const DEMO_PROVIDER_KEYS = [
  { id: 1, keyPrefix: "sk-or-v1-...8k3m", provider: "openrouter", model: "moonshotai/kimi-k2.5", group: "primary", tier: "free", status: "active", totalCalls: 2847, totalErrors: 3, latencyMs: 342 },
  { id: 2, keyPrefix: "sk-or-v1-...p2q9", provider: "openrouter", model: "openrouter/elephant-alpha", group: "primary", tier: "free", status: "active", totalCalls: 1203, totalErrors: 0, latencyMs: 289 },
  { id: 3, keyPrefix: "sk-or-v1-...x7r1", provider: "openrouter", model: "stepfun/step-3.5-flash:free", group: "standard", tier: "free", status: "active", totalCalls: 3812, totalErrors: 8, latencyMs: 410 },
  { id: 4, keyPrefix: "sk-or-v1-...m4n2", provider: "openrouter", model: "z-ai/glm-4.5-air:free", group: "standard", tier: "free", status: "degraded", totalCalls: 412, totalErrors: 47, latencyMs: 820, lastError: "Rate limit exceeded — 429 Too Many Requests" },
  { id: 5, keyPrefix: "AIzaSy...k9qw", provider: "gemini", model: "gemini-2.0-flash", group: "gemini", tier: "free", status: "active", totalCalls: 1449, totalErrors: 6, latencyMs: 198 },
];

const DEMO_KEY_STATUS = {
  totalKeys: 5,
  active: 4,
  degraded: 1,
  inactive: 0,
  byProvider: [
    { provider: "openrouter", active: 3, total: 4, totalCalls: 8274 },
    { provider: "gemini", active: 1, total: 1, totalCalls: 1449 },
  ],
  byTier: [
    { tier: "free", active: 4, total: 5 },
  ],
};

const DEMO_KEY_USAGE_REPORT = {
  summary: { totalKeys: 5, activeKeys: 4, degradedKeys: 1, unusedKeys: 0, totalCalls: 9723, totalErrors: 64 },
  byGroup: [
    { group: "primary", active: 2, total: 2, totalCalls: 4050 },
    { group: "standard", active: 1, total: 2, totalCalls: 4224 },
    { group: "gemini", active: 1, total: 1, totalCalls: 1449 },
  ],
  recommendations: [
    "Add more primary-tier keys to handle traffic peaks",
    "Rotate the degraded OpenRouter key (sk-or-v1-...m4n2) — it has 47 recent errors",
  ],
};

const DEMO_AI_POOL = {
  total: 5,
  healthy: 4,
  degraded: 1,
  byProvider: { openrouter: 4, gemini: 1 },
  keys: [
    { label: "sk-or-v1-...8k3m", status: "healthy" as const, provider: "openrouter", cooldownUntil: null, lastUsed: "2026-04-20T10:00:00Z", failCount: 0 },
    { label: "sk-or-v1-...p2q9", status: "healthy" as const, provider: "openrouter", cooldownUntil: null, lastUsed: "2026-04-20T09:45:00Z", failCount: 0 },
    { label: "sk-or-v1-...x7r1", status: "healthy" as const, provider: "openrouter", cooldownUntil: null, lastUsed: "2026-04-20T09:30:00Z", failCount: 2 },
    { label: "sk-or-v1-...m4n2", status: "daily_limit" as const, provider: "openrouter", cooldownUntil: "2026-04-21T00:00:00Z", lastUsed: "2026-04-19T23:58:00Z", failCount: 47 },
    { label: "AIzaSy...k9qw", status: "healthy" as const, provider: "gemini", cooldownUntil: null, lastUsed: "2026-04-20T10:01:00Z", failCount: 0 },
  ],
};

const DEMO_PROVIDERS = [
  { id: 1, name: "OpenRouter", slug: "openrouter", isEnabled: true, priority: 1, requestCount: 8432, errorCount: 12, lastUsedAt: "2026-04-20T10:00:00Z", createdAt: "2026-01-10T00:00:00Z" },
  { id: 2, name: "Google Gemini", slug: "gemini", isEnabled: true, priority: 2, requestCount: 3291, errorCount: 4, lastUsedAt: "2026-04-19T22:30:00Z", createdAt: "2026-01-10T00:00:00Z" },
  { id: 3, name: "Anthropic Claude", slug: "claude", isEnabled: false, priority: 3, requestCount: 0, errorCount: 0, lastUsedAt: null, createdAt: "2026-03-01T00:00:00Z" },
];

const DEMO_ADMIN_STATS = {
  totalUsers: 1284,
  freeUsers: 891,
  paidUsers: 393,
  totalRevenue: 23088200,
  activeSubscriptions: 393,
  totalPhotosProcessed: 12847,
  totalVideosProcessed: 5585,
  jobsToday: 47,
  failedJobsToday: 3,
  conversionRate: 0.306,
  recentSignups: DEMO_ADMIN_USERS.slice(0, 4),
  recentPayments: DEMO_PAYMENTS.filter(p => p.status === "success").slice(0, 4),
};

// ── Response helpers ────────────────────────────────────────────────────────

function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function err(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── URL matcher ─────────────────────────────────────────────────────────────

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.pathname + input.search;
  return input.url;
}

// ── Main interceptor ─────────────────────────────────────────────────────────

export async function handleDemoRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  // Simulate a small network delay for realism
  await new Promise((r) => setTimeout(r, Math.random() * 180 + 40));

  const rawUrl = resolveUrl(input);
  // Strip the base path prefix if present (e.g. /GlimpseAI/api/... → /api/...)
  const url = rawUrl.replace(/^\/GlimpseAI/, "");
  const method = (init?.method ?? "GET").toUpperCase();

  // ── Auth ──────────────────────────────────────────────────────────────────
  if (url === "/api/auth/login" && method === "POST") {
    try {
      const body = JSON.parse((init?.body as string) ?? "{}");
      // Accept any non-empty credentials in demo mode
      if (!body.email || !body.password) return err("Email and password are required");
      return ok({ token: DEMO_TOKEN, user: DEMO_USER });
    } catch {
      return err("Invalid request body");
    }
  }

  if (url === "/api/auth/register" && method === "POST") {
    return ok({ token: DEMO_TOKEN, user: DEMO_USER }, 201);
  }

  if (url === "/api/auth/forgot-password" && method === "POST") {
    return ok({ success: true, message: "Password reset email sent (demo mode)" });
  }

  if (url === "/api/auth/me" && method === "GET") {
    return ok(DEMO_USER);
  }

  // ── Users ────────────────────────────────────────────────────────────────
  if (url === "/api/users/usage" && method === "GET") {
    return ok(DEMO_USAGE);
  }

  if (url === "/api/users/profile" && method === "PATCH") {
    return ok(DEMO_USER);
  }

  // ── Media ────────────────────────────────────────────────────────────────
  if (url.startsWith("/api/media/jobs") && method === "GET") {
    const match = url.match(/\/api\/media\/jobs\/(\d+)/);
    if (match) {
      const job = DEMO_JOBS.find((j) => j.id === Number(match[1])) ?? DEMO_JOBS[0];
      return ok(job);
    }
    // The generated API client (listMediaJobs) expects MediaJob[] — plain array, not paginated wrapper.
    return ok(DEMO_JOBS);
  }

  if (url === "/api/media/upload" && method === "POST") {
    return ok({ jobId: 102, message: "Upload successful (demo mode)" }, 201);
  }

  if (url === "/api/media/enhance" && method === "POST") {
    const newJob = {
      ...DEMO_JOBS[0],
      id: 102,
      filename: "demo_enhanced.jpg",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    return ok(newJob);
  }

  if (url === "/api/media/analyze" && method === "POST") {
    return ok({
      analysis: {
        brightness: 0.62,
        contrast: 0.71,
        saturation: 0.55,
        sharpness: 0.80,
        suggestions: ["Increase brightness by 15%", "Boost saturation slightly", "Apply light sharpening"],
      },
    });
  }

  // ── Plans ────────────────────────────────────────────────────────────────
  if (url === "/api/plans" && method === "GET") {
    return ok(DEMO_PLANS);
  }

  // ── Payments ────────────────────────────────────────────────────────────
  if (url.startsWith("/api/payments")) {
    return ok({ success: true, message: "Payment processing unavailable in demo mode" });
  }

  // ── Admin ────────────────────────────────────────────────────────────────
  if (url === "/api/admin/stats" && method === "GET") {
    return ok(DEMO_ADMIN_STATS);
  }

  if (url === "/api/admin/usage" && method === "GET") {
    const daily = Array.from({ length: 30 }, (_, i) => {
      const d = new Date("2026-04-20");
      d.setDate(d.getDate() - (29 - i));
      return {
        date: d.toISOString().slice(0, 10),
        jobs: Math.floor(Math.random() * 80 + 20),
        photos: Math.floor(Math.random() * 50 + 10),
        videos: Math.floor(Math.random() * 30 + 5),
        revenue: Math.floor(Math.random() * 500000 + 100000),
        signups: Math.floor(Math.random() * 15 + 2),
      };
    });
    return ok({ daily });
  }

  if (url === "/api/admin/funnel" && method === "GET") {
    return ok({ registered: 1284, activated: 987, converted: 393, retained: 312 });
  }

  if (url.startsWith("/api/admin/users") && !url.includes("/suspend") && !url.includes("/credits")) {
    return ok({ users: DEMO_ADMIN_USERS, total: DEMO_ADMIN_USERS.length, page: 1, totalPages: 1 });
  }

  if (url.startsWith("/api/admin/jobs")) {
    const filteredJobs = DEMO_JOBS.slice();
    return ok({ jobs: filteredJobs, total: filteredJobs.length, page: 1, totalPages: 1 });
  }

  if (url.startsWith("/api/admin/payments")) {
    return ok({ payments: DEMO_PAYMENTS, total: DEMO_PAYMENTS.length, page: 1, totalPages: 1 });
  }

  if (url === "/api/admin/plans" && method === "GET") {
    return ok(DEMO_PLANS);
  }

  if (url === "/api/admin/providers" && method === "GET") {
    return ok(DEMO_PROVIDERS);
  }

  // Provider keys & health (must be before generic /api/admin catch-all)
  if (url.includes("/api/admin/provider-keys/status") && method === "GET") {
    return ok(DEMO_KEY_STATUS);
  }
  if (url.includes("/api/admin/provider-keys/usage-report") && method === "GET") {
    return ok(DEMO_KEY_USAGE_REPORT);
  }
  if (url.includes("/api/admin/provider-keys") && method === "GET") {
    return ok({ keys: DEMO_PROVIDER_KEYS });
  }
  if (url.includes("/api/admin/provider-keys")) {
    return ok({ success: true });
  }

  // AI pool & recommendations
  if (url === "/api/admin/ai-pool" && method === "GET") {
    return ok(DEMO_AI_POOL);
  }
  if (url === "/api/admin/ai-recommendations" && method === "GET") {
    return ok({ recommendations: [
      { id: "rec1", title: "Add more primary-tier API keys", description: "Only 2 primary keys are active. Adding 2–3 more will prevent bottlenecks during peak hours.", severity: "warning", category: "api-health", action: "Go to AI Providers & Keys → Bulk Import" },
      { id: "rec2", title: "face_restore is the most-applied enhancement", description: "72% of users who apply face restoration keep the result. Consider surfacing it more prominently in the enhancement picker.", severity: "info", category: "product", action: "Update default enhancement order in settings" },
    ]});
  }

  // Analytics endpoints
  if (url.startsWith("/api/admin/analytics/")) {
    if (url.includes("daily-summary")) {
      const daily = Array.from({ length: 30 }, (_, i) => {
        const d = new Date("2026-04-20");
        d.setDate(d.getDate() - (29 - i));
        const base = 40 + Math.round(Math.sin(i / 4) * 20);
        return {
          date: d.toISOString().slice(0, 10),
          totalEnhancements: base + Math.floor(Math.random() * 15),
          uniqueUsers: Math.floor(base * 0.6) + Math.floor(Math.random() * 8),
          avgProcessingMs: 1800 + Math.floor(Math.random() * 600),
        };
      });
      return ok({ daily });
    }
    if (url.includes("enhancement-types")) {
      return ok({ types: [
        { type: "face_restore", total: 3812 },
        { type: "auto", total: 2940 },
        { type: "portrait", total: 2104 },
        { type: "upscale", total: 1823 },
        { type: "old_photo_restore", total: 1247 },
        { type: "hdr", total: 842 },
        { type: "cinematic", total: 673 },
        { type: "skin_retouch", total: 442 },
      ]});
    }
    if (url.includes("top-users")) {
      return ok({ users: DEMO_ADMIN_USERS.map((u, i) => ({
        userId: u.id,
        totalJobs: [142, 87, 12, 203, 0][i] ?? 0,
        completedJobs: [138, 84, 11, 196, 0][i] ?? 0,
        avgProcessingMs: [2100, 1840, 1920, 2340, 0][i] ?? 0,
        user: u,
      }))});
    }
    if (url.includes("monthly-summary")) {
      return ok({ months: [
        { month: "2026-01", totalJobs: 1203, completed: 1150, failed: 53, avgProcessingMs: 2100, uniqueUsers: 287 },
        { month: "2026-02", totalJobs: 1847, completed: 1791, failed: 56, avgProcessingMs: 1980, uniqueUsers: 341 },
        { month: "2026-03", totalJobs: 2634, completed: 2570, failed: 64, avgProcessingMs: 1870, uniqueUsers: 412 },
        { month: "2026-04", totalJobs: 1482, completed: 1447, failed: 35, avgProcessingMs: 1820, uniqueUsers: 398 },
      ]});
    }
    if (url.includes("key-usage")) {
      return ok({ usage: [] });
    }
    return ok({ success: true, data: [] });
  }

  if (url.startsWith("/api/admin")) {
    return ok({ success: true, data: [] });
  }

  // ── Presets ──────────────────────────────────────────────────────────────
  if (url === "/api/presets" && method === "GET") {
    return ok([]);
  }

  // ── Health ───────────────────────────────────────────────────────────────
  if (url === "/api/health") {
    return ok({ status: "demo" });
  }

  // Fallback
  return err("Not found (demo mode)", 404);
}

// ── Install the interceptor ──────────────────────────────────────────────────

export function installDemoInterceptor(): void {
  if (typeof window === "undefined") return;

  // Auto-login with demo token so the app loads authenticated
  if (!localStorage.getItem("glimpse_token")) {
    localStorage.setItem("glimpse_token", DEMO_TOKEN);
  }

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = resolveUrl(input);
    // Only intercept /api calls (or /GlimpseAI/api calls)
    if (/\/(GlimpseAI\/)?api\//.test(rawUrl) || rawUrl.startsWith("/api/")) {
      return handleDemoRequest(input, init);
    }
    return originalFetch(input, init);
  };

  console.info(
    "%c🎭 GlimpseAI Demo Mode",
    "color:#14b8a6;font-size:14px;font-weight:bold",
    "\nRunning on GitHub Pages with mock API. Login with any credentials.",
  );
}
