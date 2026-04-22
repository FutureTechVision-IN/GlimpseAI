#!/usr/bin/env node
// =============================================================================
// encrypt-env.mjs — Encrypts .env → .env.enc using AES-256-GCM
//
// Usage:
//   KEY_ENCRYPTION_SECRET="your-32+-char-secret" node scripts/encrypt-env.mjs
//
// The output .env.enc is safe to commit (it's encrypted).
// Add .env.enc to your deployment artifacts.
// =============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function deriveKey(secret) {
  return createHash("sha256").update(secret).digest();
}

function encrypt(plaintext, secret) {
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

// ── Main ──

const secret = process.env.KEY_ENCRYPTION_SECRET;
if (!secret || secret.length < 32) {
  console.error("ERROR: Set KEY_ENCRYPTION_SECRET (min 32 chars) before running.");
  console.error("  export KEY_ENCRYPTION_SECRET=\"$(openssl rand -hex 32)\"");
  process.exit(1);
}

const envPath = resolve(process.cwd(), ".env");
const outPath = resolve(process.cwd(), ".env.enc");

let envContent;
try {
  envContent = readFileSync(envPath, "utf8");
} catch {
  console.error(`ERROR: Cannot read ${envPath}`);
  process.exit(1);
}

// Filter: only encrypt lines containing sensitive keys, not comments or blank
const sensitivePatterns = [
  /^PROVIDER_KEYS_/,
  /^GEMINI_API_KEYS=/,
  /^OPENROUTER_/,
  /^RAZORPAY_/,
  /^JWT_SECRET=/,
  /^SESSION_SECRET=/,
  /^ADMIN_PASSWORD=/,
  /^DATABASE_URL=/,
  /^NVIDIA_API_KEY=/,
];

const lines = envContent.split("\n");
const secretLines = lines.filter((line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return false;
  return sensitivePatterns.some((p) => p.test(trimmed));
});

if (secretLines.length === 0) {
  console.error("WARNING: No sensitive keys found in .env — nothing to encrypt.");
  process.exit(1);
}

const toEncrypt = secretLines.join("\n");
const encrypted = encrypt(toEncrypt, secret);

writeFileSync(outPath, encrypted, "utf8");
console.log(`✅ Encrypted ${secretLines.length} secret(s) → ${outPath}`);
console.log("   Store KEY_ENCRYPTION_SECRET securely (e.g., Railway env vars).");
console.log("   .env.enc is safe to commit. .env must NEVER be committed.");
