import { createDecipheriv, createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "./logger";

// =============================================================================
// KeyVault — Encrypted-at-rest key storage with runtime decryption
//
// In DEVELOPMENT: reads .env directly (standard dotenv behaviour).
// In PRODUCTION : decrypts .env.enc using KEY_ENCRYPTION_SECRET.
//
// Encryption format (AES-256-GCM):
//   <iv:12 bytes hex>:<authTag:16 bytes hex>:<ciphertext hex>
//
// Generate .env.enc via:  node scripts/encrypt-env.mjs
// =============================================================================

const ALGORITHM = "aes-256-gcm";

/** Derive a 32-byte key from the human-readable secret */
function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

/** Decrypt a single AES-256-GCM encrypted string */
function decrypt(encrypted: string, secret: string): string {
  const parts = encrypted.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted format — expected iv:authTag:ciphertext");

  const iv = Buffer.from(parts[0]!, "hex");
  const authTag = Buffer.from(parts[1]!, "hex");
  const ciphertext = Buffer.from(parts[2]!, "hex");
  const key = deriveKey(secret);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Parse KEY=VALUE lines (same format as .env).
 * Ignores comments (#) and blank lines. Strips surrounding quotes.
 */
function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export interface VaultLoadResult {
  source: "env" | "encrypted";
  keysLoaded: number;
}

/**
 * Load secrets into process.env.
 *
 * Priority:
 *   1. If KEY_ENCRYPTION_SECRET is set and .env.enc exists → decrypt & merge
 *   2. Otherwise fall through (rely on existing process.env / dotenv)
 *
 * Existing env vars are NOT overwritten (12-factor: explicit env wins).
 */
export function loadSecrets(): VaultLoadResult {
  const encSecret = process.env.KEY_ENCRYPTION_SECRET;
  const isProduction = process.env.NODE_ENV === "production";

  // In production, prefer encrypted vault
  if (encSecret) {
    const encPath = resolve(process.cwd(), ".env.enc");
    if (existsSync(encPath)) {
      try {
        const raw = readFileSync(encPath, "utf8").trim();
        const plaintext = decrypt(raw, encSecret);
        const parsed = parseEnvContent(plaintext);

        let loaded = 0;
        for (const [k, v] of Object.entries(parsed)) {
          if (!process.env[k]) {
            process.env[k] = v;
            loaded++;
          }
        }

        logger.info({ source: "encrypted", keysLoaded: loaded }, "Secrets loaded from .env.enc");
        return { source: "encrypted", keysLoaded: loaded };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err: msg }, "Failed to decrypt .env.enc — check KEY_ENCRYPTION_SECRET");
        if (isProduction) {
          throw new Error("Cannot start in production without valid encrypted secrets");
        }
      }
    } else if (isProduction) {
      logger.warn(".env.enc not found — running production without encrypted vault");
    }
  }

  // Development: no encryption required — .env is loaded by dotenv or shell
  logger.info({ source: "env" }, "Using plain-text environment variables (dev mode)");
  return { source: "env", keysLoaded: 0 };
}
