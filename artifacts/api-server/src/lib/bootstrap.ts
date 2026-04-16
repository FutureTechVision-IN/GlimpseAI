import bcrypt from "bcryptjs";
import { count, eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logger } from "./logger";

const DEFAULT_ADMIN_NAME = process.env.ADMIN_NAME ?? "Glimpse Admin";
const DEFAULT_ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@glimpse.ai";
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "s/Pp<6h6&3aY";

export async function ensureInitialAdmin(): Promise<void> {
  const [{ value: userCount }] = await db
    .select({ value: count() })
    .from(usersTable);

  if (userCount > 0) {
    return;
  }

  const [existingAdmin] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, DEFAULT_ADMIN_EMAIL));

  if (existingAdmin) {
    return;
  }

  const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);

  await db.insert(usersTable).values({
    name: DEFAULT_ADMIN_NAME,
    email: DEFAULT_ADMIN_EMAIL,
    passwordHash,
    role: "admin",
    creditsUsed: 0,
    creditsLimit: 999999,
    isSuspended: false,
  });

  logger.info({ email: DEFAULT_ADMIN_EMAIL }, "Bootstrapped initial admin user");
}
