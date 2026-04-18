import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

// Single consistent default — must match what start.sh uses
const DEFAULT_JWT_SECRET = "glimpse-ai-local-dev-secret";
const JWT_SECRET = process.env.SESSION_SECRET || DEFAULT_JWT_SECRET;

if (!process.env.SESSION_SECRET) {
  logger.warn("SESSION_SECRET not set — using default. Set it in .env for production.");
}

export interface AuthRequest extends Request {
  userId?: number;
  userRole?: string;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.debug({ url: req.url }, "Auth rejected: no Bearer token");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number; role: string };
    req.userId = payload.userId;
    req.userRole = payload.role;
    next();
  } catch (err) {
    logger.debug({ url: req.url, err: (err as Error).message }, "Auth rejected: invalid/expired token");
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.userRole !== "admin") {
    logger.warn({ userId: req.userId, role: req.userRole, url: req.url }, "Admin access denied");
    res.status(403).json({ error: "Forbidden — admin access required" });
    return;
  }
  next();
}

export function generateToken(userId: number, role: string): string {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: "30d" });
}

export async function getUserById(userId: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return user;
}
