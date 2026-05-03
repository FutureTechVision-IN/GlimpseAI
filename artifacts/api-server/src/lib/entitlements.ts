import { db, usersTable, plansTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { PlanSlug } from "./tier-config";
import { resolvePlanSlug } from "./tier-config";

export interface EntitlementUser {
  role: string;
  planId: number | null;
  planExpiresAt: Date | null;
  premiumTrialEndsAt: Date | null;
}

/**
 * Resolves effective tier for feature gating: admin → premium;
 * active premium trial → premium; expired subscription → free; else plan slug.
 */
export function resolveEffectivePlanSlug(
  planSlugFromDb: string | null | undefined,
  user: EntitlementUser,
): PlanSlug {
  if (user.role === "admin") return "premium";
  const now = new Date();
  if (user.premiumTrialEndsAt && user.premiumTrialEndsAt > now) {
    return "premium";
  }
  if (!user.planId) {
    return "free";
  }
  if (user.planExpiresAt && user.planExpiresAt <= now) {
    return "free";
  }
  return resolvePlanSlug(planSlugFromDb, false);
}

/** Max batch jobs per request by tier slug */
export function maxBatchJobsForPlan(slug: PlanSlug): number {
  switch (slug) {
    case "free":
      return 0;
    case "basic":
      return Number(process.env.BATCH_MAX_BASIC ?? "5");
    case "premium":
      return Number(process.env.BATCH_MAX_PREMIUM ?? "10");
    default:
      return 5;
  }
}

/**
 * When subscription end date has passed, downgrade to Free limits so entitlement + quotas align.
 */
export async function downgradeExpiredSubscription(userId: number): Promise<void> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user?.planId || !user.planExpiresAt) return;
  if (user.planExpiresAt > new Date()) return;

  const [freePlan] = await db.select().from(plansTable).where(eq(plansTable.slug, "free"));

  await db
    .update(usersTable)
    .set({
      planId: null,
      creditsLimit: freePlan?.creditsPerMonth ?? 5,
      dailyLimit: 5,
      dailyCreditsUsed: 0,
    })
    .where(eq(usersTable.id, userId));
}
