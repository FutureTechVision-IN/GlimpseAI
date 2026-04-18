import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
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
      // Always re-hash the expected password and update if it changed.
      // This ensures admin login works even after password changes in .env
      // or if the initial hash was corrupted.
      const currentMatch = await bcrypt.compare(account.password, existing.passwordHash);
      if (!currentMatch) {
        const newHash = await bcrypt.hash(account.password, 10);
        await db.update(usersTable)
          .set({ passwordHash: newHash, isSuspended: false })
          .where(eq(usersTable.id, existing.id));
        logger.info({ email: account.email }, "Admin password re-synced from config");
      }
      // Ensure role is admin (in case it was accidentally changed)
      if (existing.role !== "admin") {
        await db.update(usersTable)
          .set({ role: "admin" })
          .where(eq(usersTable.id, existing.id));
        logger.info({ email: account.email }, "Admin role restored");
      }
      logger.info({ email: account.email, id: existing.id }, "Admin account verified");
      continue;
    }

    const passwordHash = await bcrypt.hash(account.password, 10);

    const [user] = await db.insert(usersTable).values({
      name: account.name,
      email: account.email,
      passwordHash,
      role: "admin",
      creditsUsed: 0,
      creditsLimit: 999999,
      isSuspended: false,
    }).returning();

    logger.info({ email: account.email, id: user.id }, "Bootstrapped new admin user");
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
