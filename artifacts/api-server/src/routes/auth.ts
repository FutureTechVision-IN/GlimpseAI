import { Router, IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db, usersTable, plansTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { generateToken, requireAuth, AuthRequest } from "../middlewares/auth";
import { RegisterBody, LoginBody, ForgotPasswordBody, ResetPasswordBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { createRateLimiter } from "../lib/rate-limit";

const registerLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 15,
  keyPrefix: "auth-register",
});
const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 40,
  keyPrefix: "auth-login",
});
const forgotLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyPrefix: "auth-forgot",
});

/** Resolve the plan slug for a user, joining the plans table when needed */
async function getUserPlanSlug(planId: number | null): Promise<string | null> {
  if (!planId) return null;
  const [plan] = await db.select({ slug: plansTable.slug }).from(plansTable).where(eq(plansTable.id, planId));
  return plan?.slug ?? null;
}

const router: IRouter = Router();

function normalizeLoginEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

router.post("/auth/register", registerLimiter, async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { name, email, password } = parsed.data;
  const emailNormalized = normalizeLoginEmail(email);

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(sql`lower(${usersTable.email}) = ${emailNormalized}`);
  if (existing) {
    res.status(400).json({ error: "Email already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db.insert(usersTable).values({
    name,
    email: emailNormalized,
    passwordHash,
    role: "user",
    creditsUsed: 0,
    creditsLimit: 5,
  }).returning();

  const token = generateToken(user.id, user.role);
  res.status(201).json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      planId: user.planId,
      planSlug: null,
      creditsUsed: user.creditsUsed,
      creditsLimit: user.creditsLimit,
      isSuspended: user.isSuspended,
      premiumTrialEndsAt: user.premiumTrialEndsAt?.toISOString() ?? null,
      createdAt: user.createdAt,
    },
    token,
  });
});

router.post("/auth/login", loginLimiter, async (req, res): Promise<void> => {
  try {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) {
      logger.warn({ zodError: parsed.error.message }, "Login: body validation failed");
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { email, password } = parsed.data;
    const emailNormalized = normalizeLoginEmail(email);

    const [user] = await db
      .select()
      .from(usersTable)
      .where(sql`lower(${usersTable.email}) = ${emailNormalized}`);
    if (!user) {
      logger.warn({ email: emailNormalized }, "Login: user not found");
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    if (user.isSuspended) {
      logger.warn({ email: emailNormalized, userId: user.id }, "Login: account suspended");
      res.status(403).json({ error: "Account suspended" });
      return;
    }

    if (!user.passwordHash) {
      logger.error({ email: emailNormalized, userId: user.id }, "Login: passwordHash is null/empty");
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      logger.warn(
        { email: emailNormalized, userId: user.id, hashLen: user.passwordHash.length },
        "Login: bcrypt compare failed",
      );
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const token = generateToken(user.id, user.role);
    const planSlug = await getUserPlanSlug(user.planId);
    logger.info({ email: emailNormalized, userId: user.id, role: user.role }, "Login: success");
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        planId: user.planId,
        planSlug,
        creditsUsed: user.creditsUsed,
        creditsLimit: user.creditsLimit,
        isSuspended: user.isSuspended,
        premiumTrialEndsAt: user.premiumTrialEndsAt?.toISOString() ?? null,
        createdAt: user.createdAt,
      },
      token,
    });
  } catch (err) {
    logger.error({ err, email: req.body?.email }, "Login: unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/logout", async (_req, res): Promise<void> => {
  res.json({ success: true, message: "Logged out" });
});

router.get("/auth/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const planSlug = await getUserPlanSlug(user.planId);
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    planId: user.planId,
    planSlug,
    creditsUsed: user.creditsUsed,
    creditsLimit: user.creditsLimit,
    isSuspended: user.isSuspended,
    premiumTrialEndsAt: user.premiumTrialEndsAt?.toISOString() ?? null,
    createdAt: user.createdAt,
  });
});

router.post("/auth/forgot-password", forgotLimiter, async (req, res): Promise<void> => {
  const parsed = ForgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { email } = parsed.data;
  const emailNormalized = normalizeLoginEmail(email);
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 3600000);

  await db.update(usersTable)
    .set({ resetPasswordToken: token, resetPasswordExpires: expires })
    .where(sql`lower(${usersTable.email}) = ${emailNormalized}`);

  req.log.info({ email }, "Password reset requested");
  res.json({ success: true, message: "If that email exists, a reset link has been sent" });
});

router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { token, password } = parsed.data;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.resetPasswordToken, token));
  if (!user || !user.resetPasswordExpires || user.resetPasswordExpires < new Date()) {
    res.status(400).json({ error: "Invalid or expired reset token" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await db.update(usersTable)
    .set({ passwordHash, resetPasswordToken: null, resetPasswordExpires: null })
    .where(eq(usersTable.id, user.id));

  res.json({ success: true, message: "Password reset successfully" });
});

export default router;
