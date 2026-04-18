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
  planId: 2,
  creditsUsed: 47,
  creditsLimit: 100,
  isSuspended: false,
  createdAt: "2026-01-15T09:00:00Z",
};

const DEMO_USAGE = {
  creditsUsed: 47,
  creditsLimit: 100,
  creditsRemaining: 53,
  planName: "Pro",
  planExpiry: "2026-12-31T23:59:59Z",
  photoCount: 38,
  videoCount: 9,
  totalJobs: 47,
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
    name: "Starter",
    priceMonthly: 0,
    priceYearly: 0,
    creditsPerMonth: 20,
    features: ["20 credits/month", "Photo enhancement", "Basic filters"],
    isActive: true,
    stripePriceIdMonthly: null,
    stripePriceIdYearly: null,
  },
  {
    id: 2,
    name: "Pro",
    priceMonthly: 1499,
    priceYearly: 14990,
    creditsPerMonth: 100,
    features: ["100 credits/month", "Photo & Video", "AI filters", "Priority processing"],
    isActive: true,
    stripePriceIdMonthly: "price_pro_monthly",
    stripePriceIdYearly: "price_pro_yearly",
  },
  {
    id: 3,
    name: "Studio",
    priceMonthly: 3999,
    priceYearly: 39990,
    creditsPerMonth: 500,
    features: ["500 credits/month", "All media types", "AI guidance", "4K output", "API access"],
    isActive: true,
    stripePriceIdMonthly: "price_studio_monthly",
    stripePriceIdYearly: "price_studio_yearly",
  },
];

const DEMO_ADMIN_STATS = {
  totalUsers: 1284,
  activeUsers: 847,
  totalJobs: 18432,
  totalRevenue: 48920,
  recentActivity: DEMO_JOBS,
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
    return ok({ items: DEMO_JOBS, total: DEMO_JOBS.length, page: 1, totalPages: 1 });
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
  if (url.startsWith("/api/admin/users")) {
    return ok({ items: [DEMO_USER], total: 1, page: 1, totalPages: 1 });
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
