import { Router, IRouter } from "express";
import { db, plansTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/plans", async (_req, res): Promise<void> => {
  const plans = await db.select().from(plansTable).where(eq(plansTable.isActive, true));
  res.json(plans.map(p => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    priceMonthly: p.priceMonthly,
    priceAnnual: p.priceAnnual,
    creditsPerMonth: p.creditsPerMonth,
    features: p.features,
    isActive: p.isActive,
    isPopular: p.isPopular,
  })));
});

export default router;
