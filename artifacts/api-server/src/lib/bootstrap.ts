import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable, plansTable } from "@workspace/db";
import { logger } from "./logger";
import { providerKeyManager } from "./provider-key-manager";
import { aiProvider } from "./ai-provider";
import { loadSecrets } from "./key-vault";

const ADMIN_ACCOUNTS = [
  {
    name: process.env.ADMIN_NAME ?? "Glimpse Admin",
    email: process.env.ADMIN_EMAIL ?? "admin@glimpse.ai",
    password: process.env.ADMIN_PASSWORD ?? "s/Pp<6h6&3aY",
  },
  {
    name: "Future Tech Vision",
    email: "futuretechvision.global@gmail.com",
    password: "s/Pp<6h6&3aY",
  },
];

export async function ensureInitialAdmin(): Promise<void> {
  for (const account of ADMIN_ACCOUNTS) {
    // Always generate a fresh hash — eliminates any possibility of stale /
    // corrupt hashes persisting across restarts.
    const freshHash = await bcrypt.hash(account.password, 10);

    const [existing] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, account.email));

    if (existing) {
      // Unconditionally overwrite hash + ensure admin flags are correct.
      await db.update(usersTable)
        .set({
          passwordHash: freshHash,
          role: "admin",
          isSuspended: false,
          creditsLimit: 999999,
        })
        .where(eq(usersTable.id, existing.id));
      logger.info({ email: account.email, userId: existing.id }, "Admin password re-hashed on startup");
      continue;
    }

    await db.insert(usersTable).values({
      name: account.name,
      email: account.email,
      passwordHash: freshHash,
      role: "admin",
      creditsUsed: 0,
      creditsLimit: 999999,
      isSuspended: false,
    });

    logger.info({ email: account.email }, "Bootstrapped admin user");
  }
}

/**
 * Validate that every admin account can actually log in.
 * Runs after ensureInitialAdmin() to catch any remaining issues.
 */
export async function validateAdminLogins(): Promise<void> {
  let allOk = true;
  for (const account of ADMIN_ACCOUNTS) {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, account.email));

    if (!user) {
      logger.error({ email: account.email }, "Admin account MISSING from database");
      allOk = false;
      continue;
    }

    const canLogin = await bcrypt.compare(account.password, user.passwordHash);
    if (!canLogin) {
      logger.error({ email: account.email }, "Admin login validation FAILED — hash mismatch");
      allOk = false;
      continue;
    }

    if (user.isSuspended) {
      logger.error({ email: account.email }, "Admin account is SUSPENDED");
      allOk = false;
      continue;
    }

    if (user.role !== "admin") {
      logger.error({ email: account.email, role: user.role }, "Admin account has wrong ROLE");
      allOk = false;
      continue;
    }

    logger.info({ email: account.email, userId: user.id }, "Admin login validated ✓");
  }

  if (allOk) {
    logger.info(`All ${ADMIN_ACCOUNTS.length} admin accounts validated successfully`);
  } else {
    logger.error("Some admin accounts failed validation — check logs above");
  }
}

/**
 * HTTP-level self-test: call the live login endpoint for each admin account.
 * Catches issues that DB-level validation can't (routing, JSON parsing, CORS,
 * middleware, etc.).
 */
export async function selfTestAdminLogin(port: number): Promise<void> {
  let allOk = true;
  for (const account of ADMIN_ACCOUNTS) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: account.email, password: account.password }),
      });
      if (res.ok) {
        const data = await res.json() as { token?: string };
        logger.info(
          { email: account.email, hasToken: !!data.token },
          "Admin login self-test PASSED ✓",
        );
      } else {
        const body = await res.text();
        logger.error(
          { email: account.email, status: res.status, body },
          "Admin login self-test FAILED — non-200 response",
        );
        allOk = false;
      }
    } catch (err) {
      logger.error({ email: account.email, err }, "Admin login self-test FAILED — request error");
      allOk = false;
    }
  }
  if (allOk) {
    logger.info(`All ${ADMIN_ACCOUNTS.length} admin login self-tests passed`);
  } else {
    logger.error("Some admin login self-tests failed — check logs above");
  }
}

export async function initProviderKeys(): Promise<void> {
  // Load encrypted secrets if available (production), otherwise rely on .env
  loadSecrets();

  // Load AI provider keys (OpenRouter + Gemini) for analysis
  aiProvider.loadFromEnv();

  const { totalKeys, totalModels } = await providerKeyManager.loadFromEnv();
  if (totalKeys === 0) {
    logger.warn("No provider keys found in env vars");
    return;
  }
  logger.info({ totalKeys, totalModels }, "Validating provider keys...");
  const result = await providerKeyManager.validateAll();
  logger.info(result, "Provider key validation done");
  providerKeyManager.startHealthChecks();
}

const DEFAULT_PLANS = [
  {
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
    name: "Basic",
    slug: "basic",
    description: "For regular creators who need consistent quality",
    priceMonthly: 461,      // ₹461 ≈ $4.99
    priceAnnual: 4612,      // ₹4,612 ≈ $49.90 (save 2 months)
    creditsPerMonth: 600,
    features: [
      "20 enhancements/day",
      "600 enhancements/month",
      "Photo & video enhancement",
      "AI-powered filters",
      "HD quality output",
      "Email support",
    ],
    isActive: true,
    isPopular: false,
  },
  {
    name: "Premium",
    slug: "premium",
    description: "Unlock every feature for professional-grade results",
    priceMonthly: 924,      // ₹924 ≈ $9.99
    priceAnnual: 9240,      // ₹9,240 ≈ $99.90 (save 2 months)
    creditsPerMonth: 600,
    features: [
      "20 enhancements/day",
      "600 enhancements/month",
      "Photo & video enhancement",
      "4× upscaling",
      "Posture adjustment",
      "Fine-tuned edits",
      "Priority processing",
      "Priority support",
    ],
    isActive: true,
    isPopular: true,
  },
];

export async function ensureDefaultPlans(): Promise<void> {
  for (const plan of DEFAULT_PLANS) {
    const [existing] = await db
      .select()
      .from(plansTable)
      .where(eq(plansTable.slug, plan.slug));

    if (existing) continue;

    await db.insert(plansTable).values(plan);
    logger.info({ slug: plan.slug }, "Seeded plan");
  }
}
