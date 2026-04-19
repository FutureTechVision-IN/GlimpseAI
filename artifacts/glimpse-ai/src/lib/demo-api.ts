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
    priceMonthly: 461,
    priceAnnual: 4612,
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
    priceMonthly: 924,
    priceAnnual: 9240,
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
  { id: 1, userId: 1, planId: 3, amount: 92400, currency: "INR", status: "success", razorpayOrderId: "order_demo_001", razorpayPaymentId: null, billingPeriod: "annual", createdAt: "2026-01-15T09:05:00Z" },
  { id: 2, userId: 2, planId: 2, amount: 46100, currency: "INR", status: "success", razorpayOrderId: "order_demo_002", razorpayPaymentId: null, billingPeriod: "annual", createdAt: "2026-02-10T08:35:00Z" },
  { id: 3, userId: 4, planId: 3, amount: 92400, currency: "INR", status: "success", razorpayOrderId: "order_demo_003", razorpayPaymentId: null, billingPeriod: "annual", createdAt: "2026-03-22T11:05:00Z" },
  { id: 4, userId: 3, planId: 1, amount: 0, currency: "INR", status: "success", razorpayOrderId: null, razorpayPaymentId: null, billingPeriod: null, createdAt: "2026-03-05T14:25:00Z" },
  { id: 5, userId: 5, planId: 2, amount: 46100, currency: "INR", status: "failed", razorpayOrderId: "order_demo_005", razorpayPaymentId: null, billingPeriod: "annual", createdAt: "2026-04-01T09:20:00Z" },
];

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
