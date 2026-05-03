import { Router, IRouter } from "express";
import crypto from "crypto";
import Razorpay from "razorpay";
import { db, paymentsTable, plansTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { CreatePaymentOrderBody, VerifyPaymentBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID ?? "";
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? "";

const razorpayKeysConfigured =
  Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) &&
  !RAZORPAY_KEY_ID.includes("placeholder") &&
  RAZORPAY_KEY_SECRET !== "placeholder_secret";

/** Only for local dev without Razorpay keys — never enable in production */
const paymentVerifyDisabled =
  process.env.PAYMENT_VERIFY_DISABLED === "true" && process.env.NODE_ENV !== "production";

let razorpay: Razorpay | null = null;
try {
  if (razorpayKeysConfigured) {
    razorpay = new Razorpay({
      key_id: RAZORPAY_KEY_ID,
      key_secret: RAZORPAY_KEY_SECRET,
    });
    logger.info("Razorpay SDK initialized");
  } else {
    logger.warn("Razorpay running in test mode (no real key configured)");
  }
} catch (err) {
  logger.warn({ err }, "Failed to initialize Razorpay SDK");
}

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

  let orderId: string;

  if (razorpay) {
    // Real Razorpay order creation
    try {
      const order = await razorpay.orders.create({
        amount: amount * 100, // Razorpay expects paise (1 INR = 100 paise)
        currency: "INR",
        receipt: `glimpse_${req.userId}_${Date.now()}`,
        notes: {
          userId: String(req.userId),
          planId: String(planId),
          billingPeriod,
        },
      });
      orderId = order.id;
    } catch (err) {
      logger.error({ err }, "Razorpay order creation failed");
      res.status(500).json({ error: "Payment service unavailable. Please try again." });
      return;
    }
  } else {
    // Test mode fallback
    orderId = `order_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

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
    keyId: razorpayKeysConfigured ? RAZORPAY_KEY_ID : "rzp_test_mode",
  });
});

router.post("/payments/verify", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = VerifyPaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { razorpayOrderId, razorpayPaymentId, razorpaySignature, planId, billingPeriod } = parsed.data;

  if (razorpayKeysConfigured) {
    const expectedSig = crypto
      .createHmac("sha256", RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");

    if (expectedSig !== razorpaySignature) {
      logger.warn({ razorpayOrderId }, "Payment signature mismatch");
      res.status(400).json({ error: "Invalid payment signature" });
      return;
    }
  } else if (!paymentVerifyDisabled) {
    res.status(503).json({
      error: "Payment verification is not configured. Set Razorpay keys or PAYMENT_VERIFY_DISABLED=true (development only).",
    });
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
      dailyCreditsUsed: 0,
      dailyLimit: 20, // paid users get 20 enhancements/day
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

router.post("/payments/webhook", async (_req, res): Promise<void> => {
  if (process.env.NODE_ENV === "production") {
    logger.warn("Razorpay webhook called but signature verification is not implemented — rejecting");
    res.status(501).json({ error: "Webhook handler not configured" });
    return;
  }
  logger.info("Razorpay webhook received (development noop)");
  res.json({ success: true });
});

export default router;
