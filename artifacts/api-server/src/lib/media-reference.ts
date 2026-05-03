import crypto from "crypto";

export interface ReferenceParts {
  jobId: number;
  enhancementType: string;
  completedAt: Date;
  suffix: string;
}

/**
 * Builds a stable internal reference for exports and admin tracing.
 * Format: GLP-{jobId}-{enhancementSlug}-{YYYYMMDD}-{suffix}
 */
export function buildMediaReferenceCode(parts: ReferenceParts): string {
  const ymd = parts.completedAt.toISOString().slice(0, 10).replace(/-/g, "");
  const enhSlug = parts.enhancementType.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32) || "enh";
  const suffix =
    parts.suffix ||
    crypto.randomBytes(3).toString("hex"); // 6 hex chars
  return `GLP-${parts.jobId}-${enhSlug}-${ymd}-${suffix}`;
}

/**
 * Parse reference code (best-effort). Returns null if malformed.
 */
export function parseMediaReferenceCode(code: string): {
  jobId: number;
  enhancementType: string;
  dateYmd: string;
  suffix: string;
} | null {
  const m = /^GLP-(\d+)-([a-zA-Z0-9_]+)-(\d{8})-([a-f0-9]+)$/i.exec(code.trim());
  if (!m) return null;
  return {
    jobId: Number(m[1]),
    enhancementType: m[2],
    dateYmd: m[3],
    suffix: m[4],
  };
}
