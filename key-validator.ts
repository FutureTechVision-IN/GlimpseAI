import fs from "fs";
import path from "path";
import { execSync } from "child_process";

// =============================================================================
// API Key Validation and Organization System
// =============================================================================

interface ValidationResult {
  key: string;
  keyPrefix: string;
  provider: string;
  model?: string;
  status: "valid" | "invalid" | "expired" | "rate_limited" | "unknown";
  latencyMs: number | null;
  errorMessage: string | null;
  validatedAt: string;
  successfulRequests?: number;
  failedRequests?: number;
}

interface ProviderConfig {
  name: string;
  testEndpoint: string;
  headers: (key: string) => Record<string, string>;
  body: (key: string) => string;
  timeout: number;
  statusCodes: { success: number[]; invalid: number[]; rateLimited: number[] };
}

const PROVIDERS_CONFIG: Record<string, ProviderConfig> = {
  openrouter: {
    name: "OpenRouter",
    testEndpoint: "https://openrouter.ai/api/v1/chat/completions",
    headers: (key) => ({
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://glimpse.ai",
      "X-Title": "GlimpseAI-KeyValidator",
    }),
    body: () =>
      JSON.stringify({
        model: "nvidia/nemotron-3-nano-30b-a3b:free",
        messages: [{ role: "user", content: "test" }],
        max_tokens: 1,
      }),
    timeout: 15000,
    statusCodes: {
      success: [200],
      invalid: [401, 403],
      rateLimited: [429],
    },
  },
  gemini: {
    name: "Google Gemini",
    testEndpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
    headers: () => ({ "Content-Type": "application/json" }),
    body: (key) =>
      JSON.stringify({
        contents: [{ parts: [{ text: "test" }] }],
        generationConfig: { maxOutputTokens: 10 },
        safetySettings: [],
      }) + `?key=${encodeURIComponent(key)}`,
    timeout: 15000,
    statusCodes: {
      success: [200],
      invalid: [400, 403, 401],
      rateLimited: [429, 503],
    },
  },
};

class KeyValidator {
  private envPath: string;
  private logPath: string;
  private results: Map<string, ValidationResult> = new Map();

  constructor(envPath = ".env", logDir = ".key-validation-logs") {
    this.envPath = envPath;
    this.logPath = logDir;
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  // ---- Parse .env ----

  parseEnv(): Map<string, { provider: string; keys: string[] }> {
    if (!fs.existsSync(this.envPath)) {
      throw new Error(`.env file not found at ${this.envPath}`);
    }

    const content = fs.readFileSync(this.envPath, "utf-8");
    const lines = content.split("\n");
    const groups: Map<string, { provider: string; keys: string[] }> = new Map();

    const keyPatterns = [
      { pattern: /PROVIDER_KEYS_(.+?)=(.+)/, provider: "openrouter" },
      { pattern: /GEMINI_API_KEYS=(.+)/, provider: "gemini" },
    ];

    for (const line of lines) {
      if (line.startsWith("#") || !line.trim()) continue;

      for (const { pattern, provider } of keyPatterns) {
        const match = line.match(pattern);
        if (match) {
          const keys = match[match.length - 1]
            .split(",")
            .map((k) => k.trim())
            .filter((k) => k.length > 0);
          const groupKey = provider === "openrouter" && match[1] ? match[1] : provider;
          groups.set(groupKey, { provider, keys });
          break;
        }
      }
    }

    return groups;
  }

  // ---- Validate Key ----

  async validateKey(
    key: string,
    provider: string,
    model?: string
  ): Promise<ValidationResult> {
    const config = PROVIDERS_CONFIG[provider];
    if (!config) {
      return {
        key,
        keyPrefix: this.maskKey(key),
        provider,
        status: "unknown",
        latencyMs: null,
        errorMessage: `Unknown provider: ${provider}`,
        validatedAt: new Date().toISOString(),
      };
    }

    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeout);

      const testUrl =
        provider === "gemini"
          ? config.testEndpoint + `?key=${encodeURIComponent(key)}`
          : config.testEndpoint;

      const testBody =
        provider === "gemini"
          ? JSON.stringify({
              contents: [{ parts: [{ text: "test" }] }],
              generationConfig: { maxOutputTokens: 10 },
            })
          : config.body(key);

      const resp = await fetch(testUrl, {
        method: "POST",
        headers: config.headers(key),
        body: testBody,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const latency = Date.now() - start;

      if (config.statusCodes.success.includes(resp.status)) {
        return {
          key,
          keyPrefix: this.maskKey(key),
          provider,
          model,
          status: "valid",
          latencyMs: latency,
          errorMessage: null,
          validatedAt: new Date().toISOString(),
        };
      } else if (config.statusCodes.invalid.includes(resp.status)) {
        const body = await resp.text().catch(() => "");
        return {
          key,
          keyPrefix: this.maskKey(key),
          provider,
          model,
          status: resp.status === 401 || resp.status === 403 ? "expired" : "invalid",
          latencyMs: latency,
          errorMessage: `HTTP ${resp.status}: ${body.slice(0, 150)}`,
          validatedAt: new Date().toISOString(),
        };
      } else if (config.statusCodes.rateLimited.includes(resp.status)) {
        return {
          key,
          keyPrefix: this.maskKey(key),
          provider,
          model,
          status: "rate_limited",
          latencyMs: latency,
          errorMessage: "Rate limited or service temporarily unavailable",
          validatedAt: new Date().toISOString(),
        };
      }

      const body = await resp.text().catch(() => "");
      return {
        key,
        keyPrefix: this.maskKey(key),
        provider,
        model,
        status: "unknown",
        latencyMs: latency,
        errorMessage: `Unexpected status ${resp.status}`,
        validatedAt: new Date().toISOString(),
      };
    } catch (err) {
      const latency = Date.now() - start;
      return {
        key,
        keyPrefix: this.maskKey(key),
        provider,
        model,
        status: "invalid",
        latencyMs: latency,
        errorMessage: err instanceof Error ? err.message : String(err),
        validatedAt: new Date().toISOString(),
      };
    }
  }

  // ---- Validation Campaign ----

  async validateAll(concurrency = 5): Promise<ValidationResult[]> {
    const groups = this.parseEnv();
    const allResults: ValidationResult[] = [];

    for (const [group, { provider, keys }] of groups) {
      console.log(`\\n[${provider.toUpperCase()}] Validating ${keys.length} keys from ${group}...`);

      const queue = [...keys];
      const active: Promise<ValidationResult>[] = [];

      while (queue.length > 0 || active.length > 0) {
        while (active.length < concurrency && queue.length > 0) {
          const key = queue.shift()!;
          const model =
            provider === "openrouter"
              ? this.groupToModel(group)
              : undefined;
          const promise = this.validateKey(key, provider, model).then((result) => {
            console.log(
              `  ${result.keyPrefix} ... ${result.status} (${result.latencyMs}ms)`
            );
            allResults.push(result);
            this.results.set(result.keyPrefix, result);
            return result;
          });
          active.push(promise);
        }

        if (active.length > 0) {
          await Promise.race(active);
          active.splice(
            active.findIndex((p) => p.then(() => true).catch(() => false)),
            1
          );
        }
      }

      // Rate limit: wait between provider groups
      await new Promise((r) => setTimeout(r, 2000));
    }

    return allResults;
  }

  // ---- Report Generation ----

  generateReport(results: ValidationResult[]): string {
    const byStatus = {
      valid: results.filter((r) => r.status === "valid"),
      expired: results.filter((r) => r.status === "expired"),
      invalid: results.filter((r) => r.status === "invalid"),
      rate_limited: results.filter((r) => r.status === "rate_limited"),
      unknown: results.filter((r) => r.status === "unknown"),
    };

    const byProvider: Record<string, number> = {};
    for (const r of results) {
      byProvider[r.provider] = (byProvider[r.provider] ?? 0) + 1;
    }

    const avgLatency =
      results
        .filter((r) => r.latencyMs !== null)
        .reduce((sum, r) => sum + (r.latencyMs ?? 0), 0) / (results.length || 1);

    const timestamp = new Date().toISOString();
    const report = `
================================================================================
                    API KEY VALIDATION REPORT
================================================================================
Timestamp: ${timestamp}
Total Keys Tested: ${results.length}

SUMMARY:
--------
  ✓ Valid:         ${byStatus.valid.length}
  ✗ Expired:       ${byStatus.expired.length}
  ✗ Invalid:       ${byStatus.invalid.length}
  ⚠ Rate Limited:  ${byStatus.rate_limited.length}
  ? Unknown:       ${byStatus.unknown.length}

PROVIDER BREAKDOWN:
-------------------
${Object.entries(byProvider)
  .map(([provider, count]) => `  ${provider.padEnd(20)}: ${count}`)
  .join("\n")}

PERFORMANCE:
-----------
  Average Latency: ${avgLatency.toFixed(0)}ms
  Fastest Key:     ${Math.min(...results.map((r) => r.latencyMs ?? Infinity))}ms
  Slowest Key:     ${Math.max(...results.map((r) => r.latencyMs ?? 0))}ms

VALID KEYS (Ready for Use):
---------------------------
${byStatus.valid.map((r) => `  ${r.keyPrefix} (${r.provider}, ${r.model || "N/A"}, ${r.latencyMs}ms)`).join("\n")}

EXPIRED/REVOKED KEYS (Action Required):
---------------------------------------
${byStatus.expired.map((r) => `  ${r.keyPrefix} (${r.provider}) - ${r.errorMessage}`).join("\n")}

INVALID KEYS (Check Format):
----------------------------
${byStatus.invalid.map((r) => `  ${r.keyPrefix} (${r.provider}) - ${r.errorMessage}`).join("\n")}

RATE LIMITED (Retry Later):
--------------------------
${byStatus.rate_limited.map((r) => `  ${r.keyPrefix} (${r.provider})`).join("\n")}

================================================================================
`;

    return report;
  }

  // ---- .env Rewrite ----

  rewriteEnv(results: ValidationResult[]): string {
    const valid = results.filter((r) => r.status === "valid");
    const invalid = results.filter((r) => r.status !== "valid");

    const groupedValid = this.groupByProvider(valid);
    const groupedInvalid = this.groupByProvider(invalid);

    let output = `# GlimpseAI API Keys
# Auto-organized on ${new Date().toISOString()}
# Valid keys are listed first for immediate use
# Invalid/expired keys are below with error details

`;

    // Valid keys section
    output += `# ============================================================================
# VALID KEYS - Ready for Production Use
# ============================================================================

`;

    for (const [provider, keys] of Object.entries(groupedValid)) {
      output += `# ${provider}\n`;
      const keysByGroup = this.groupKeysByModel(provider, keys);
      for (const [group, groupKeys] of Object.entries(keysByGroup)) {
        output += `${group}=${groupKeys.map((r) => r.key).join(",")}\n`;
      }
      output += "\n";
    }

    // Invalid keys section
    if (invalid.length > 0) {
      output += `# ============================================================================
# INVALID / EXPIRED / RATE LIMITED KEYS
# These keys need replacement or investigation
# ============================================================================

`;

      for (const [provider, keys] of Object.entries(groupedInvalid)) {
        output += `# ${provider}\n`;
        for (const key of keys) {
          output += `# [${key.status.toUpperCase()}] ${key.keyPrefix}\n`;
          output += `#   Error: ${key.errorMessage}\n`;
          output += `#   Validated: ${key.validatedAt}\n`;
          output += `#   Full Key: ${key.key}\n\n`;
        }
      }
    }

    output += `# OpenRouter API base URL\nOPENROUTER_BASE_URL=https://openrouter.ai/api/v1\n`;

    return output;
  }

  // ---- Helpers ----

  private maskKey(key: string): string {
    return key.slice(0, 8) + "..." + key.slice(-4);
  }

  private groupByProvider(results: ValidationResult[]): Record<string, ValidationResult[]> {
    const groups: Record<string, ValidationResult[]> = {};
    for (const r of results) {
      if (!groups[r.provider]) groups[r.provider] = [];
      groups[r.provider].push(r);
    }
    return groups;
  }

  private groupKeysByModel(
    provider: string,
    results: ValidationResult[]
  ): Record<string, ValidationResult[]> {
    const groups: Record<string, ValidationResult[]> = {};
    for (const r of results) {
      const key =
        provider === "openrouter"
          ? `PROVIDER_KEYS_${r.model?.toUpperCase().replace(/[:-]/g, "_") || "UNKNOWN"}`
          : "GEMINI_API_KEYS";
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }
    return groups;
  }

  private groupToModel(group: string): string {
    return group.replace(/PROVIDER_KEYS_/, "").replace(/_/g, "-").toLowerCase();
  }

  // ---- Logging ----

  saveValidationLog(results: ValidationResult[]): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logFile = path.join(this.logPath, `validation-${timestamp}.json`);
    fs.writeFileSync(
      logFile,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          totalKeys: results.length,
          results,
        },
        null,
        2
      )
    );
    console.log(`\\nValidation log saved to ${logFile}`);
  }

  saveReport(report: string): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const reportFile = path.join(this.logPath, `report-${timestamp}.txt`);
    fs.writeFileSync(reportFile, report);
    console.log(`Report saved to ${reportFile}`);
  }
}

// ---- Main Execution ----

async function main() {
  const validator = new KeyValidator();

  console.log("Starting API key validation campaign...");
  console.log(`Testing keys from: ${process.cwd()}/.env\n`);

  try {
    const results = await validator.validateAll(/* concurrency */ 3);

    const report = validator.generateReport(results);
    console.log(report);

    validator.saveReport(report);
    validator.saveValidationLog(results);

    const newEnv = validator.rewriteEnv(results);
    const backupPath = ".env.backup-" + new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(".env", backupPath);
    console.log(`Backup saved to ${backupPath}`);

    fs.writeFileSync(".env", newEnv);
    console.log("✓ .env file has been reorganized with valid keys at the top\n");

    // Statistics
    const valid = results.filter((r) => r.status === "valid");
    const invalid = results.filter((r) => r.status !== "valid");
    console.log(`Summary: ${valid.length} valid, ${invalid.length} invalid/expired`);
  } catch (err) {
    console.error("Validation failed:", err);
    process.exit(1);
  }
}

main();
