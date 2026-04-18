import { Router, IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateToken, requireAuth, AuthRequest } from "../middlewares/auth";
import { RegisterBody, LoginBody, ForgotPasswordBody, ResetPasswordBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { name, email, password } = parsed.data;

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    res.status(400).json({ error: "Email already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db.insert(usersTable).values({
    name,
    email,
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
      creditsUsed: user.creditsUsed,
      creditsLimit: user.creditsLimit,
      isSuspended: user.isSuspended,
      createdAt: user.createdAt,
    },
    token,
  });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { email, password } = parsed.data;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  if (user.isSuspended) {
    res.status(403).json({ error: "Account suspended" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = generateToken(user.id, user.role);
  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      planId: user.planId,
      creditsUsed: user.creditsUsed,
      creditsLimit: user.creditsLimit,
      isSuspended: user.isSuspended,
      createdAt: user.createdAt,
    },
    token,
  });
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
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    planId: user.planId,
    creditsUsed: user.creditsUsed,
    creditsLimit: user.creditsLimit,
    isSuspended: user.isSuspended,
    createdAt: user.createdAt,
  });
});

router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const parsed = ForgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { email } = parsed.data;
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 3600000);

  await db.update(usersTable)
    .set({ resetPasswordToken: token, resetPasswordExpires: expires })
    .where(eq(usersTable.email, email));

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
