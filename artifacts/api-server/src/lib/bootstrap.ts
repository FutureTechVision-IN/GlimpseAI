import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logger } from "./logger";
import { providerKeyManager } from "./provider-key-manager";
import { aiProvider } from "./ai-provider";

function getBootstrapAdminAccount(): { name: string; email: string; password: string } | null {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    const message = "ADMIN_EMAIL and ADMIN_PASSWORD are required to bootstrap the initial admin user";
    if (process.env.NODE_ENV === "production") throw new Error(message);
    logger.warn(message);
    return null;
  }

  return {
    name: process.env.ADMIN_NAME?.trim() || "Glimpse Admin",
    email,
    password,
  };
}

export async function ensureInitialAdmin(): Promise<void> {
  const account = getBootstrapAdminAccount();
  if (!account) return;

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, account.email));

  if (existing) return;

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

export async function initProviderKeys(): Promise<void> {
  // Load AI provider keys (OpenRouter + Gemini) for analysis
  aiProvider.loadFromEnv();

  const { totalKeys, totalModels } = providerKeyManager.loadFromEnv();
  if (totalKeys === 0) {
    logger.warn("No provider keys found in env vars");
    return;
  }
  logger.info({ totalKeys, totalModels }, "Validating provider keys...");
  const result = await providerKeyManager.validateAll();
  logger.info(result, "Provider key validation done");
  providerKeyManager.startHealthChecks();
}
