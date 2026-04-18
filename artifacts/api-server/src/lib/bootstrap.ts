import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable, plansTable } from "@workspace/db";
import { logger } from "./logger";
import { providerKeyManager } from "./provider-key-manager";
import { aiProvider } from "./ai-provider";

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
    const [existing] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, account.email));

    if (existing) {
      continue;
    }

    const passwordHash = await bcrypt.hash(account.password, 10);

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

export async function initProviderKeys(): Promise<void> {
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
