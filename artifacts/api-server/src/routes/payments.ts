import { Router, IRouter } from "express";
import crypto from "crypto";
import Razorpay from "razorpay";
import { db, paymentsTable, plansTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { CreatePaymentOrderBody, VerifyPaymentBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { sendErrorEnvelope, FRIENDLY } from "../lib/error-envelope";
import {
  CREDIT_PACKS,
  CONTRIBUTION_TIERS,
  CHARITY_INFO,
  findCreditPack,
  findContributionTier,
} from "../lib/billing-catalog";

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
      await sendErrorEnvelope(req, res, {
        ...FRIENDLY.PAYMENT_GATEWAY_UNAVAILABLE,
        httpStatus: 503,
        adminDetail: `Razorpay order creation failed (plan ${planId}, ${billingPeriod}). Inspect Razorpay dashboard for the linked merchant account and confirm the API keys + webhook health.`,
        suggestedResolution:
          "Verify RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are present and not placeholders. Try a manual order from Razorpay dashboard. If outage is on Razorpay side, the user can retry in a few minutes.",
        metadata: { planId, billingPeriod, errorMessage: err instanceof Error ? err.message : String(err) },
      });
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
      await sendErrorEnvelope(req, res, {
        ...FRIENDLY.PAYMENT_VERIFY_FAILED,
        httpStatus: 400,
        adminDetail: `Razorpay signature mismatch for order ${razorpayOrderId}. Either the webhook secret rotated or someone replayed an order with a forged signature.`,
        suggestedResolution:
          "Confirm RAZORPAY_KEY_SECRET matches the live merchant account. Check the order in Razorpay dashboard — if the payment did succeed, settle the user manually and rotate the secret.",
        metadata: { razorpayOrderId, planId, billingPeriod },
      });
      return;
    }
  } else if (!paymentVerifyDisabled) {
    await sendErrorEnvelope(req, res, {
      ...FRIENDLY.PAYMENT_GATEWAY_UNAVAILABLE,
      httpStatus: 503,
      adminDetail:
        "Razorpay verification is not configured (no production keys present and PAYMENT_VERIFY_DISABLED is not set). New purchases will fail until keys are provisioned.",
      suggestedResolution:
        "Set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in the deployment env. PAYMENT_VERIFY_DISABLED=true is dev-only and never honoured in production.",
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

// ─────────────────────────────────────────────────────────────────────────────
// Hybrid commerce: one-time credit packs + voluntary contributions.
// The billing catalog is hardcoded server-side in lib/billing-catalog.ts so
// the frontend has a single source of truth (no risk of stale localStorage
// or out-of-sync ENV configs).
// ─────────────────────────────────────────────────────────────────────────────

/** Public — list available one-time credit packs. */
router.get("/payments/credit-packs", (_req, res): void => {
  res.json({ packs: CREDIT_PACKS });
});

/** Public — list voluntary contribution tiers. */
router.get("/payments/contribution-tiers", (_req, res): void => {
  res.json({ tiers: CONTRIBUTION_TIERS });
});

/** Public — charity disclosure (percentage + description). Surfaced on every
 *  commerce page so users always see how their money supports charity. */
router.get("/payments/charity-info", (_req, res): void => {
  res.json(CHARITY_INFO);
});

/**
 * Create a Razorpay order for a credit pack. Mirrors the subscription
 * `/payments/create-order` flow so the frontend can open Razorpay Checkout
 * and produce a payment proof to send back to `/payments/purchase-credits`
 * for verification + grant.
 *
 * Returns: `{ orderId, amount (INR rupees), currency, keyId, packId }`.
 * In stub mode (no Razorpay keys) returns a synthetic orderId so dev flows
 * can exercise the verify path with `PAYMENT_VERIFY_DISABLED=true`.
 */
router.post("/payments/credit-packs/create-order", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { packId } = req.body ?? {};
  if (typeof packId !== "string") {
    res.status(400).json({ error: "packId is required" });
    return;
  }
  const pack = findCreditPack(packId);
  if (!pack) {
    res.status(404).json({ error: "Unknown credit pack" });
    return;
  }

  let orderId: string;
  if (razorpay) {
    try {
      const order = await razorpay.orders.create({
        amount: pack.priceInr * 100, // paise
        currency: "INR",
        receipt: `pack_${req.userId}_${Date.now()}`,
        notes: {
          userId: String(req.userId),
          packId: pack.id,
          credits: String(pack.credits),
          kind: "credit_pack",
        },
      });
      orderId = order.id;
    } catch (err) {
      await sendErrorEnvelope(req, res, {
        ...FRIENDLY.PAYMENT_GATEWAY_UNAVAILABLE,
        httpStatus: 503,
        adminDetail: `Razorpay credit-pack order creation failed (pack=${pack.id}, ₹${pack.priceInr}).`,
        suggestedResolution:
          "Check Razorpay dashboard for outages. Confirm the merchant account is active and that key/secret env vars match the live account.",
        metadata: { packId: pack.id, priceInr: pack.priceInr, errorMessage: err instanceof Error ? err.message : String(err) },
      });
      return;
    }
  } else {
    orderId = `order_pack_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  await db.insert(paymentsTable).values({
    userId: req.userId!,
    planId: null,
    amount: pack.priceInr,
    currency: "INR",
    status: "pending",
    razorpayOrderId: orderId,
    billingPeriod: "one-time",
  });

  res.json({
    orderId,
    amount: pack.priceInr,
    currency: "INR",
    keyId: razorpayKeysConfigured ? RAZORPAY_KEY_ID : "rzp_test_mode",
    packId: pack.id,
    credits: pack.credits,
  });
});

/**
 * Purchase a credit pack. Adds `pack.credits` to the user's `creditsLimit`
 * (additive — packs stack on top of the subscription monthly cap) and records
 * a payment row for the audit trail. Razorpay verification follows the same
 * pattern as the subscription /payments/verify route.
 *
 * Stub mode: when Razorpay keys aren't configured, this route accepts the
 * purchase without on-chain verification but still records the payment so
 * the audit trail and credit grant are consistent.
 */
router.post("/payments/purchase-credits", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { packId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body ?? {};
  if (typeof packId !== "string") {
    res.status(400).json({ error: "packId is required" });
    return;
  }
  const pack = findCreditPack(packId);
  if (!pack) {
    res.status(404).json({ error: "Unknown credit pack" });
    return;
  }

  // Optional signature verification — only enforced when Razorpay keys are set.
  if (razorpayKeysConfigured) {
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      res.status(400).json({ error: "Payment proof is required (orderId, paymentId, signature)." });
      return;
    }
    const expectedSig = crypto
      .createHmac("sha256", RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");
    if (expectedSig !== razorpaySignature) {
      logger.warn({ packId, razorpayOrderId }, "Credit pack signature mismatch");
      await sendErrorEnvelope(req, res, {
        ...FRIENDLY.PAYMENT_VERIFY_FAILED,
        httpStatus: 400,
        adminDetail: `Razorpay signature mismatch for credit pack ${pack.id} (order ${razorpayOrderId}).`,
        suggestedResolution:
          "Reconcile the payment in Razorpay dashboard before granting credits manually. Rotate RAZORPAY_KEY_SECRET if compromise is suspected.",
        metadata: { packId: pack.id, razorpayOrderId },
      });
      return;
    }
  } else if (!paymentVerifyDisabled) {
    await sendErrorEnvelope(req, res, {
      ...FRIENDLY.PAYMENT_GATEWAY_UNAVAILABLE,
      httpStatus: 503,
      adminDetail:
        "Razorpay verification is not configured for credit-pack purchases. New pack purchases will fail until keys are provisioned.",
      suggestedResolution:
        "Set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET. PAYMENT_VERIFY_DISABLED=true is dev-only.",
    });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Grant credits — additive to existing cap.
  const newLimit = user.creditsLimit + pack.credits;
  await db.update(usersTable)
    .set({ creditsLimit: newLimit })
    .where(eq(usersTable.id, req.userId!));

  // Update the pending row created by /payments/credit-packs/create-order
  // (when a Razorpay order id was supplied) to `success`. If the row doesn't
  // exist yet — e.g. in dev mode where the frontend skipped Razorpay — we
  // insert a fresh success row so the audit trail is consistent.
  if (razorpayOrderId) {
    await db.update(paymentsTable)
      .set({ status: "success", razorpayPaymentId: razorpayPaymentId ?? null })
      .where(eq(paymentsTable.razorpayOrderId, razorpayOrderId));
  } else {
    await db.insert(paymentsTable).values({
      userId: req.userId!,
      planId: null,
      amount: pack.priceInr,
      currency: "INR",
      status: "success",
      razorpayOrderId: `stub_${pack.id}_${Date.now()}`,
      razorpayPaymentId: null,
      billingPeriod: "one-time",
    });
  }

  logger.info({ userId: req.userId, packId: pack.id, credits: pack.credits, newLimit }, "Credit pack purchased");
  res.json({
    success: true,
    creditsGranted: pack.credits,
    newCreditsLimit: newLimit,
    pack,
  });
});

/**
 * Create a Razorpay order for a voluntary contribution. The frontend then
 * opens Razorpay Checkout and posts the proof to `/contributions/donate` for
 * verification + recording.
 */
router.post("/contributions/create-order", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { tierId, customAmountInr } = req.body ?? {};

  let amount: number;
  let label: string;
  if (typeof tierId === "string") {
    const tier = findContributionTier(tierId);
    if (!tier) {
      res.status(404).json({ error: "Unknown contribution tier" });
      return;
    }
    amount = tier.amountInr;
    label = tier.label;
  } else if (typeof customAmountInr === "number" && customAmountInr >= 50 && customAmountInr <= 100_000) {
    amount = Math.floor(customAmountInr);
    label = "Custom contribution";
  } else {
    res.status(400).json({ error: "Provide either a tierId or a customAmountInr between 50 and 100000." });
    return;
  }

  let orderId: string;
  if (razorpay) {
    try {
      const order = await razorpay.orders.create({
        amount: amount * 100,
        currency: "INR",
        receipt: `donate_${req.userId}_${Date.now()}`,
        notes: {
          userId: String(req.userId),
          kind: "contribution",
          label,
        },
      });
      orderId = order.id;
    } catch (err) {
      await sendErrorEnvelope(req, res, {
        ...FRIENDLY.PAYMENT_GATEWAY_UNAVAILABLE,
        httpStatus: 503,
        adminDetail: `Razorpay donation order creation failed (₹${amount}, "${label}").`,
        suggestedResolution:
          "Verify Razorpay merchant health and key configuration. Donations should be retryable from the user side once gateway is healthy.",
        metadata: { amount, label, errorMessage: err instanceof Error ? err.message : String(err) },
      });
      return;
    }
  } else {
    orderId = `order_donate_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  await db.insert(paymentsTable).values({
    userId: req.userId!,
    planId: null,
    amount,
    currency: "INR",
    status: "pending",
    razorpayOrderId: orderId,
    billingPeriod: "donation",
  });

  res.json({
    orderId,
    amount,
    currency: "INR",
    keyId: razorpayKeysConfigured ? RAZORPAY_KEY_ID : "rzp_test_mode",
    label,
  });
});

/**
 * Voluntary contribution. Records the donation but grants NO additional
 * credits — contributions are framed as platform support + charity giving,
 * not a way to buy more usage. Users get an acknowledgment with the charity
 * percentage and description so they always see where their money goes.
 */
router.post("/contributions/donate", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { tierId, customAmountInr, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body ?? {};

  let amount: number;
  let label: string;
  if (typeof tierId === "string") {
    const tier = findContributionTier(tierId);
    if (!tier) {
      res.status(404).json({ error: "Unknown contribution tier" });
      return;
    }
    amount = tier.amountInr;
    label = tier.label;
  } else if (typeof customAmountInr === "number" && customAmountInr >= 50 && customAmountInr <= 100_000) {
    amount = Math.floor(customAmountInr);
    label = "Custom contribution";
  } else {
    res.status(400).json({ error: "Provide either a tierId or a customAmountInr between 50 and 100000." });
    return;
  }

  if (razorpayKeysConfigured) {
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      res.status(400).json({ error: "Payment proof is required." });
      return;
    }
    const expectedSig = crypto
      .createHmac("sha256", RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");
    if (expectedSig !== razorpaySignature) {
      await sendErrorEnvelope(req, res, {
        ...FRIENDLY.PAYMENT_VERIFY_FAILED,
        httpStatus: 400,
        adminDetail: `Razorpay signature mismatch on donation (order ${razorpayOrderId}, ₹${amount}).`,
        suggestedResolution:
          "Reconcile in Razorpay dashboard before issuing a manual receipt or refund. Rotate the Razorpay secret if compromise is suspected.",
        metadata: { amount, label, razorpayOrderId },
      });
      return;
    }
  } else if (!paymentVerifyDisabled) {
    await sendErrorEnvelope(req, res, {
      ...FRIENDLY.PAYMENT_GATEWAY_UNAVAILABLE,
      httpStatus: 503,
      adminDetail:
        "Razorpay verification is not configured for donations. Voluntary contributions cannot be recorded until keys are provisioned.",
      suggestedResolution:
        "Set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET. PAYMENT_VERIFY_DISABLED=true is dev-only and never honoured in production.",
    });
    return;
  }

  if (razorpayOrderId) {
    await db.update(paymentsTable)
      .set({ status: "success", razorpayPaymentId: razorpayPaymentId ?? null })
      .where(eq(paymentsTable.razorpayOrderId, razorpayOrderId));
  } else {
    await db.insert(paymentsTable).values({
      userId: req.userId!,
      planId: null,
      amount,
      currency: "INR",
      status: "success",
      razorpayOrderId: `donation_${Date.now()}`,
      razorpayPaymentId: null,
      billingPeriod: "donation",
    });
  }

  logger.info({ userId: req.userId, amount, label, charityPct: CHARITY_INFO.percentage }, "Voluntary contribution recorded");
  res.json({
    success: true,
    amount,
    label,
    charity: {
      percentage: CHARITY_INFO.percentage,
      committedAmountInr: Math.floor((amount * CHARITY_INFO.percentage) / 100),
    },
  });
});

export default router;
