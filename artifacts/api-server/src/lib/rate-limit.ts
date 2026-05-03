import type { Request, Response, NextFunction } from "express";
import { logger } from "./logger";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Simple sliding-window style rate limiter (per-process). Suitable for auth endpoints.
 */
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  keyPrefix: string;
}) {
  const { windowMs, max, keyPrefix } = options;

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now > b.resetAt) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    if (b.count > max) {
      logger.warn({ key, count: b.count }, "Rate limit exceeded");
      res.setHeader("Retry-After", String(Math.ceil((b.resetAt - now) / 1000)));
      res.status(429).json({ error: "Too many requests. Try again later." });
      return;
    }
    next();
  };
}
