import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProviderKey {
  key: string;
  provider: "openrouter" | "gemini";
  model: string;
  failCount: number;
  lastUsed: number;
  cooldownUntil: number;
}

interface AnalysisResult {
  description: string;
  suggestedEnhancement: string;
  suggestedFilter: string | null;
  detectedSubjects: string[];
  confidence: number;
}

// ---------------------------------------------------------------------------
// SRE-core pattern: APIKeyPoolManager with round-robin + circuit breaker
// ---------------------------------------------------------------------------

class AIProviderService {
  private keys: ProviderKey[] = [];
  private roundRobinIndex = 0;
  private static instance: AIProviderService;

  private readonly MAX_FAILURES = 3;
  private readonly COOLDOWN_MS = 5 * 60 * 1000; // 5 min cooldown

  static getInstance(): AIProviderService {
    if (!AIProviderService.instance) {
      AIProviderService.instance = new AIProviderService();
    }
    return AIProviderService.instance;
  }

  /** Load all API keys from environment variables */
  loadFromEnv(): void {
    this.keys = [];

    // OpenRouter keys (primary) — env format: PROVIDER_KEYS_MODEL_NAME=key1,key2,...
    for (const [envKey, envVal] of Object.entries(process.env)) {
      if (envKey.startsWith("PROVIDER_KEYS_") && envVal) {
        const modelSlug = envKey.replace("PROVIDER_KEYS_", "").toLowerCase().replace(/_/g, "/");
        for (const k of envVal.split(",")) {
          const trimmed = k.trim();
          if (trimmed.startsWith("sk-or-")) {
            this.keys.push({
              key: trimmed,
              provider: "openrouter",
              model: modelSlug,
              failCount: 0,
              lastUsed: 0,
              cooldownUntil: 0,
            });
          }
        }
      }
    }

    // Gemini keys (fallback) — env format: GEMINI_API_KEYS=key1,key2,...
    const geminiRaw = process.env.GEMINI_API_KEYS ?? "";
    for (const k of geminiRaw.split(",")) {
      const trimmed = k.trim();
      if (trimmed.length > 10) {
        this.keys.push({
          key: trimmed,
          provider: "gemini",
          model: "gemini-2.0-flash",
          failCount: 0,
          lastUsed: 0,
          cooldownUntil: 0,
        });
      }
    }

    const orCount = this.keys.filter(k => k.provider === "openrouter").length;
    const gemCount = this.keys.filter(k => k.provider === "gemini").length;
    logger.info({ openrouterKeys: orCount, geminiKeys: gemCount }, "AI provider keys loaded");
  }

  /** SRE-core pattern: round-robin with circuit breaker */
  private getNextKey(preferProvider?: "openrouter" | "gemini"): ProviderKey | null {
    const now = Date.now();
    const available = this.keys.filter(k => {
      if (k.failCount >= this.MAX_FAILURES && now < k.cooldownUntil) return false;
      if (preferProvider && k.provider !== preferProvider) return false;
      // Reset cooled-down keys
      if (k.failCount >= this.MAX_FAILURES && now >= k.cooldownUntil) {
        k.failCount = 0;
      }
      return true;
    });
    if (available.length === 0) {
      // Fallback: try any provider
      if (preferProvider) return this.getNextKey();
      return null;
    }
    this.roundRobinIndex = (this.roundRobinIndex + 1) % available.length;
    return available[this.roundRobinIndex];
  }

  /** Mark key as failed (circuit breaker) */
  private markFailed(pk: ProviderKey): void {
    pk.failCount++;
    if (pk.failCount >= this.MAX_FAILURES) {
      pk.cooldownUntil = Date.now() + this.COOLDOWN_MS;
      logger.warn({ provider: pk.provider, model: pk.model }, "Provider key tripped circuit breaker");
    }
  }

  /** Mark key as used successfully */
  private markSuccess(pk: ProviderKey): void {
    pk.failCount = 0;
    pk.lastUsed = Date.now();
  }

  /** Analyze an image using vision-capable model */
  async analyzeImage(base64Data: string, mimeType: string): Promise<AnalysisResult | null> {
    // Try OpenRouter first (primary), then Gemini (fallback)
    logger.info("AI analysis: trying OpenRouter first (priority provider)");
    const result = await this.tryOpenRouterAnalysis(base64Data, mimeType);
    if (result) return result;

    logger.info("AI analysis: OpenRouter unavailable, falling back to Gemini");
    const geminiResult = await this.tryGeminiAnalysis(base64Data, mimeType);
    if (geminiResult) return geminiResult;

    logger.warn("All AI providers failed for analysis, using defaults");
    return null;
  }

  private async tryOpenRouterAnalysis(base64Data: string, mimeType: string): Promise<AnalysisResult | null> {
    const pk = this.getNextKey("openrouter");
    if (!pk) return null;

    try {
      const baseUrl = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
      // Use a vision-capable free model
      const model = "google/gemini-2.0-flash-exp:free";

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${pk.key}`,
          "HTTP-Referer": "https://glimpse.ai",
          "X-Title": "GlimpseAI",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: `data:${mimeType};base64,${base64Data.substring(0, 500)}` },
                },
                {
                  type: "text",
                  text: "Analyze this image briefly. Return JSON only: {\n\"description\": \"brief description\",\n\"suggestedEnhancement\": \"auto|portrait|color|lighting|upscale|beauty|skin|color_grade_cinematic|color_grade_warm|color_grade_cool|blur_background|skin_retouch|lighting_enhance\",\n\"suggestedFilter\": \"cinematic|vivid|film|vintage|moody|goldenhour|dramatic|airy|teal_orange|cyberpunk|null\",\n\"detectedSubjects\": [\"face\", \"landscape\", etc],\n\"confidence\": 0.0-1.0\n}",
                },
              ],
            },
          ],
          max_tokens: 200,
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        this.markFailed(pk);
        return null;
      }

      const data = await response.json() as any;
      const content = data?.choices?.[0]?.message?.content ?? "";
      this.markSuccess(pk);

      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          description: parsed.description || "Image uploaded",
          suggestedEnhancement: parsed.suggestedEnhancement || "auto",
          suggestedFilter: parsed.suggestedFilter || null,
          detectedSubjects: parsed.detectedSubjects || [],
          confidence: parsed.confidence || 0.5,
        };
      }
    } catch (e) {
      if (pk) this.markFailed(pk);
      logger.debug({ err: e }, "OpenRouter analysis failed");
    }
    return null;
  }

  private async tryGeminiAnalysis(base64Data: string, mimeType: string): Promise<AnalysisResult | null> {
    const pk = this.getNextKey("gemini");
    if (!pk) return null;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${pk.key}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType, data: base64Data.substring(0, 500) } },
              { text: "Analyze this image briefly. Return JSON only: {\"description\": \"brief\", \"suggestedEnhancement\": \"auto|portrait|color|lighting|upscale|beauty|skin\", \"detectedSubjects\": [], \"confidence\": 0.0-1.0}" },
            ],
          }],
          generationConfig: { maxOutputTokens: 200, temperature: 0.1 },
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        this.markFailed(pk);
        return null;
      }

      const data = await response.json() as any;
      const content = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      this.markSuccess(pk);

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          description: parsed.description || "Image uploaded",
          suggestedEnhancement: parsed.suggestedEnhancement || "auto",
          suggestedFilter: parsed.suggestedFilter || null,
          detectedSubjects: parsed.detectedSubjects || [],
          confidence: parsed.confidence || 0.5,
        };
      }
    } catch (e) {
      if (pk) this.markFailed(pk);
      logger.debug({ err: e }, "Gemini analysis failed");
    }
    return null;
  }

  /** Get pool stats (admin diagnostics) */
  getPoolStats() {
    const now = Date.now();
    return {
      total: this.keys.length,
      healthy: this.keys.filter(k => k.failCount < this.MAX_FAILURES || now >= k.cooldownUntil).length,
      degraded: this.keys.filter(k => k.failCount >= this.MAX_FAILURES && now < k.cooldownUntil).length,
      byProvider: {
        openrouter: this.keys.filter(k => k.provider === "openrouter").length,
        gemini: this.keys.filter(k => k.provider === "gemini").length,
      },
    };
  }
}

export const aiProvider = AIProviderService.getInstance();
