import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export function getJwtSecret(): string {
  const s = process.env.SESSION_SECRET?.trim();
  if (process.env.NODE_ENV === "production") {
    if (!s || s.length < 32) {
      throw new Error("SESSION_SECRET must be set to a strong value (32+ chars) in production");
    }
    return s;
  }
  return s || "glimpse-ai-local-dev-secret-only";
}

export interface AuthRequest extends Request {
  userId?: number;
  userRole?: string;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const secret = getJwtSecret();
    const payload = jwt.verify(token, secret) as { userId: number; role: string };
    const [user] = await db
      .select({
        id: usersTable.id,
        role: usersTable.role,
        isSuspended: usersTable.isSuspended,
      })
      .from(usersTable)
      .where(eq(usersTable.id, payload.userId));

    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (user.isSuspended) {
      res.status(403).json({ error: "Account suspended" });
      return;
    }

    req.userId = user.id;
    req.userRole = user.role;
    next();
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }
    next(err instanceof Error ? err : new Error(String(err)));
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.userRole !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

export function generateToken(userId: number, role: string): string {
  return jwt.sign({ userId, role }, getJwtSecret(), { expiresIn: "30d" });
}

export async function getUserById(userId: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return user;
}
