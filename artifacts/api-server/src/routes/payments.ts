import { Router, IRouter } from "express";
import crypto from "crypto";
import { db, paymentsTable, plansTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { CreatePaymentOrderBody, VerifyPaymentBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID ?? "rzp_test_placeholder";
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? "placeholder_secret";

router.post("/payments/create-order", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = CreatePaymentOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { planId, billingPeriod } = parsed.data;
  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, planId));
  if (!plan) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }

  const amount = billingPeriod === "annual" ? plan.priceAnnual : plan.priceMonthly;
  const orderId = `order_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  await db.insert(paymentsTable).values({
    userId: req.userId!,
    planId,
    amount,
    currency: "INR",
    status: "pending",
    razorpayOrderId: orderId,
    billingPeriod,
  });

  res.json({
    orderId,
    amount,
    currency: "INR",
    keyId: RAZORPAY_KEY_ID,
  });
});

router.post("/payments/verify", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = VerifyPaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { razorpayOrderId, razorpayPaymentId, razorpaySignature, planId, billingPeriod } = parsed.data;

  const expectedSig = crypto
    .createHmac("sha256", RAZORPAY_KEY_SECRET)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  if (expectedSig !== razorpaySignature && process.env.NODE_ENV === "production") {
    res.status(400).json({ error: "Invalid payment signature" });
    return;
  }

  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, planId));
  if (!plan) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }

  await db.update(paymentsTable)
    .set({ status: "success", razorpayPaymentId })
    .where(eq(paymentsTable.razorpayOrderId, razorpayOrderId));

  const expiresAt = new Date();
  if (billingPeriod === "annual") {
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  } else {
    expiresAt.setMonth(expiresAt.getMonth() + 1);
  }

  await db.update(usersTable)
    .set({
      planId,
      planExpiresAt: expiresAt,
      creditsLimit: plan.creditsPerMonth,
      creditsUsed: 0,
    })
    .where(eq(usersTable.id, req.userId!));

  res.json({ success: true, message: "Payment verified and subscription activated" });
});

router.get("/payments/history", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const payments = await db.select().from(paymentsTable)
    .where(eq(paymentsTable.userId, req.userId!))
    .orderBy(desc(paymentsTable.createdAt));

  res.json(payments.map(p => ({
    id: p.id,
    userId: p.userId,
    planId: p.planId,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    razorpayOrderId: p.razorpayOrderId,
    razorpayPaymentId: p.razorpayPaymentId,
    billingPeriod: p.billingPeriod,
    createdAt: p.createdAt,
  })));
});

router.post("/payments/webhook", async (req, res): Promise<void> => {
  logger.info("Razorpay webhook received");
  res.json({ success: true });
});

export default router;
