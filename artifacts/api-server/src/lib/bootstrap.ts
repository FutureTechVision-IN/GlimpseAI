import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable, plansTable } from "@workspace/db";
import { logger } from "./logger";
import { providerKeyManager } from "./provider-key-manager";
import { aiProvider } from "./ai-provider";
import { loadSecrets } from "./key-vault";

const isProduction = process.env.NODE_ENV === "production";

function normalizeBootstrapEmail(raw: string | undefined): string | undefined {
  const t = raw?.trim().toLowerCase();
  return t || undefined;
}

/** Trim end only — avoids bcrypt mismatches when secrets have trailing newlines; preserves intentional leading spaces */
function normalizeBootstrapPassword(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const t = raw.trimEnd();
  return t.length > 0 ? t : undefined;
}

function uniqueBootstrapAccounts(
  rows: Array<{ name: string; email: string; password: string }>,
): Array<{ name: string; email: string; password: string }> {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.email)) return false;
    seen.add(r.email);
    return true;
  });
}

function getBootstrapAccounts(): Array<{ name: string; email: string; password: string }> {
  const email = normalizeBootstrapEmail(process.env.ADMIN_EMAIL);
  const password = normalizeBootstrapPassword(process.env.ADMIN_PASSWORD);
  const name = process.env.ADMIN_NAME?.trim() ?? "Glimpse Admin";
  const name2 = process.env.ADMIN_NAME_2?.trim() ?? "GlimpseAI Global";

  if (isProduction) {
    if (!email || !password) {
      logger.warn(
        "ADMIN_EMAIL and ADMIN_PASSWORD must be set to bootstrap an admin user in production — skipping admin seed",
      );
      return [];
    }
    const email2 = normalizeBootstrapEmail(process.env.ADMIN_EMAIL_2);
    const primary = { name, email, password };
    if (!email2 || email2 === email) {
      return [primary];
    }
    return uniqueBootstrapAccounts([primary, { name: name2, email: email2, password }]);
  }

  // Development: allow env-only admin; optional insecure default only when explicitly allowed
  const devEmail = email ?? "admin@glimpse.ai";
  const devEmail2 =
    normalizeBootstrapEmail(process.env.ADMIN_EMAIL_2) ??
    normalizeBootstrapEmail("glimpseai.global@gmail.com");
  const devPassword =
    password ??
    (process.env.ALLOW_INSECURE_DEV_ADMIN === "true"
      ? normalizeBootstrapPassword("dev-admin-change-me")
      : undefined);
  if (!devPassword) {
    logger.warn(
      "Set ADMIN_PASSWORD or ALLOW_INSECURE_DEV_ADMIN=true (development only) to seed admin user",
    );
    return [];
  }
  const primary = { name, email: devEmail, password: devPassword };
  const secondary =
    devEmail2 && devEmail2 !== devEmail
      ? { name: name2, email: devEmail2, password: devPassword }
      : null;
  return uniqueBootstrapAccounts(secondary ? [primary, secondary] : [primary]);
}

/**
 * Ensures bootstrap admin user(s) exist from environment.
 * Primary: ADMIN_EMAIL + ADMIN_PASSWORD; optional second: ADMIN_EMAIL_2 (same password).
 * In development, ADMIN_EMAIL_2 defaults to glimpseai.global@gmail.com if unset.
 * In production, existing passwords are preserved unless ADMIN_SYNC_PASSWORD_ON_BOOT=true
 * (use once to recover from a bad hash, then disable).
 */
export async function ensureInitialAdmin(): Promise<void> {
  const accounts = getBootstrapAccounts();
  const syncProdPassword = process.env.ADMIN_SYNC_PASSWORD_ON_BOOT === "true";

  for (const account of accounts) {
    const [existing] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, account.email));

    const passwordHash = await bcrypt.hash(account.password, 10);

    if (existing) {
      if (isProduction) {
        const updates: {
          role: "admin";
          isSuspended: boolean;
          passwordHash?: string;
          creditsLimit?: number;
        } = {
          role: "admin",
          isSuspended: false,
        };
        if (syncProdPassword) {
          updates.passwordHash = passwordHash;
          updates.creditsLimit = 999999;
          logger.warn(
            { email: account.email, userId: existing.id },
            "Admin password hash updated from env (ADMIN_SYNC_PASSWORD_ON_BOOT=true — disable after recovery)",
          );
        } else {
          logger.info({ email: account.email, userId: existing.id }, "Admin flags refreshed (password unchanged in production)");
        }
        await db.update(usersTable).set(updates).where(eq(usersTable.id, existing.id));
      } else {
        await db
          .update(usersTable)
          .set({
            passwordHash,
            role: "admin",
            isSuspended: false,
            creditsLimit: 999999,
          })
          .where(eq(usersTable.id, existing.id));
        logger.info({ email: account.email, userId: existing.id }, "Development admin password updated");
      }
      continue;
    }

    await db.insert(usersTable).values({
      name: account.name,
      email: account.email,
      passwordHash,
      role: "admin",
      creditsUsed: 0,
      creditsLimit: 999999,
      isSuspended: false,
    });

    logger.info({ email: account.email }, "Bootstrapped admin user");
  }
}

export async function validateAdminLogins(): Promise<void> {
  if (process.env.VALIDATE_ADMIN_ON_BOOT !== "true") {
    return;
  }
  const accounts = getBootstrapAccounts();
  let allOk = true;
  for (const account of accounts) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, account.email));

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

    logger.info({ email: account.email, userId: user.id }, "Admin login validated");
  }

  if (accounts.length === 0) {
    return;
  }
  if (allOk) {
    logger.info(`All ${accounts.length} admin accounts validated successfully`);
  } else {
    logger.error("Some admin accounts failed validation — check logs above");
  }
}

export async function selfTestAdminLogin(port: number): Promise<void> {
  if (process.env.ENABLE_ADMIN_SELF_TEST !== "true") {
    return;
  }
  const accounts = getBootstrapAccounts();
  let allOk = true;
  for (const account of accounts) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: account.email, password: account.password }),
      });
      if (res.ok) {
        const data = (await res.json()) as { token?: string };
        logger.info({ email: account.email, hasToken: !!data.token }, "Admin login self-test PASSED");
      } else {
        const body = await res.text();
        logger.error({ email: account.email, status: res.status, body }, "Admin login self-test FAILED");
        allOk = false;
      }
    } catch (err) {
      logger.error({ email: account.email, err }, "Admin login self-test FAILED — request error");
      allOk = false;
    }
  }
  if (accounts.length === 0) return;
  if (allOk) {
    logger.info(`All ${accounts.length} admin login self-tests passed`);
  } else {
    logger.error("Some admin login self-tests failed — check logs above");
  }
}

export async function initProviderKeys(): Promise<void> {
  loadSecrets();

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
    priceMonthly: 461,
    priceAnnual: 4612,
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
    priceMonthly: 924,
    priceAnnual: 9240,
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
    const [existing] = await db.select().from(plansTable).where(eq(plansTable.slug, plan.slug));

    if (existing) continue;

    await db.insert(plansTable).values(plan);
    logger.info({ slug: plan.slug }, "Seeded plan");
  }
}
