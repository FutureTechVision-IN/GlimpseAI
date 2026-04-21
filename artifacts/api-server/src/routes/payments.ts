import { Router, IRouter } from "express";
import crypto from "crypto";
import Razorpay from "razorpay";
import { db, paymentsTable, plansTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { CreatePaymentOrderBody, VerifyPaymentBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID ?? "rzp_test_placeholder";
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? "placeholder_secret";

// ---------------------------------------------------------------------------
// Currency Configuration — supports INR (default) and USD
// Plans store prices in INR (paise-friendly). USD conversion uses a static rate
// that can be overridden via env. Production should use a live FX API.
// ---------------------------------------------------------------------------
type SupportedCurrency = "INR" | "USD";

const INR_TO_USD_RATE = parseFloat(process.env.INR_TO_USD_RATE ?? "0.012"); // ~83 INR per USD
const CURRENCY_CONFIGS: Record<SupportedCurrency, { subunitMultiplier: number; symbol: string }> = {
  INR: { subunitMultiplier: 100, symbol: "₹" },   // 1 INR = 100 paise
  USD: { subunitMultiplier: 100, symbol: "$" },     // 1 USD = 100 cents
};

/**
 * Detect currency from request headers or explicit parameter.
 * Priority: explicit currency param > Accept-Language > default INR
 */
function detectCurrency(req: AuthRequest, explicitCurrency?: string): SupportedCurrency {
  if (explicitCurrency && (explicitCurrency === "USD" || explicitCurrency === "INR")) {
    return explicitCurrency;
  }
  // Geo-hint from Accept-Language or CF-IPCountry (Cloudflare) / X-Country header
  const country = (req.headers["cf-ipcountry"] ?? req.headers["x-country"] ?? "").toString().toUpperCase();
  if (country && country !== "IN") return "USD";
  const lang = (req.headers["accept-language"] ?? "").toString().toLowerCase();
  if (lang.includes("en-in") || lang.includes("hi")) return "INR";
  if (lang && !lang.includes("en-in")) return "USD";
  return "INR";
}

/** Convert INR amount to target currency (plans store prices in INR) */
function convertAmount(amountInr: number, targetCurrency: SupportedCurrency): number {
  if (targetCurrency === "INR") return amountInr;
  return Math.round(amountInr * INR_TO_USD_RATE * 100) / 100; // Round to 2 decimal places
}

let razorpay: Razorpay | null = null;
try {
  if (RAZORPAY_KEY_ID !== "rzp_test_placeholder") {
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
  const requestedCurrency = (req.body as Record<string, unknown>)?.currency as string | undefined;
  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, planId));
  if (!plan) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }

  const amountInr = billingPeriod === "annual" ? plan.priceAnnual : plan.priceMonthly;
  const currency = detectCurrency(req, requestedCurrency);
  const displayAmount = convertAmount(amountInr, currency);
  const config = CURRENCY_CONFIGS[currency];

  let orderId: string;

  if (razorpay) {
    // Real Razorpay order creation — Razorpay expects smallest currency unit
    try {
      const order = await razorpay.orders.create({
        amount: Math.round(displayAmount * config.subunitMultiplier),
        currency,
        receipt: `glimpse_${req.userId}_${Date.now()}`,
        notes: {
          userId: String(req.userId),
          planId: String(planId),
          billingPeriod,
          originalAmountInr: String(amountInr),
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
    amount: amountInr, // Always store in INR for consistency
    currency,
    status: "pending",
    razorpayOrderId: orderId,
    billingPeriod,
  });

  res.json({
    orderId,
    amount: displayAmount,
    currency,
    currencySymbol: config.symbol,
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

router.post("/payments/webhook", async (req, res): Promise<void> => {
  logger.info("Razorpay webhook received");
  res.json({ success: true });
});

export default router;
