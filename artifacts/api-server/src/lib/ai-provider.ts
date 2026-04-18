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
  dailyLimitHit: boolean;  // free-tier daily cap exhausted
  label: string;           // human-readable key label for diagnostics
}

export interface AnalysisResult {
  description: string;
  suggestedEnhancement: string;
  suggestedFilter: string | null;
  detectedSubjects: string[];
  confidence: number;
  analysisSource: "local" | "openrouter" | "gemini";  // which engine produced this
}

// ---------------------------------------------------------------------------
// Self-Learning Feedback Accumulator
// Tracks user apply/dismiss actions → biases confidence up/down per enhancement
// ---------------------------------------------------------------------------
interface FeedbackRecord {
  applied: number;
  dismissed: number;
}

class FeedbackAccumulator {
  private store = new Map<string, FeedbackRecord>();
  private static instance: FeedbackAccumulator;

  static getInstance(): FeedbackAccumulator {
    if (!FeedbackAccumulator.instance) FeedbackAccumulator.instance = new FeedbackAccumulator();
    return FeedbackAccumulator.instance;
  }

  record(enhancement: string, action: "applied" | "dismissed"): void {
    const cur = this.store.get(enhancement) ?? { applied: 0, dismissed: 0 };
    if (action === "applied") cur.applied++;
    else cur.dismissed++;
    this.store.set(enhancement, cur);
    logger.debug({ enhancement, action, ...cur }, "Feedback recorded");
  }

  /**
   * Returns a confidence multiplier [0.80 – 1.10] for the given enhancement.
   * High acceptance rate → boost confidence; high dismiss rate → reduce.
   * Falls back to 1.0 if not enough data.
   */
  getMultiplier(enhancement: string): number {
    const rec = this.store.get(enhancement);
    if (!rec) return 1.0;
    const total = rec.applied + rec.dismissed;
    if (total < 5) return 1.0; // Not enough data to be statistically meaningful
    const rate = rec.applied / total;
    // Acceptance rate ≥ 70% → up to +10%; ≤ 20% → down to -20%
    if (rate >= 0.70) return Math.min(1.10, 1.0 + (rate - 0.70) * 0.33);
    if (rate <= 0.20) return Math.max(0.80, 1.0 - (0.20 - rate) * 0.50);
    return 1.0;
  }

  getStats(): Record<string, FeedbackRecord & { acceptanceRate: number }> {
    const result: Record<string, FeedbackRecord & { acceptanceRate: number }> = {};
    for (const [k, v] of this.store.entries()) {
      const total = v.applied + v.dismissed;
      result[k] = { ...v, acceptanceRate: total > 0 ? Math.round((v.applied / total) * 100) : 0 };
    }
    return result;
  }
}

export const feedbackAccumulator = FeedbackAccumulator.getInstance();

// Vision-capable models available on OpenRouter — ordered by quality/reliability
// Primary tier (new high-quality models) → standard tier fallback
const OPENROUTER_VISION_MODELS = [
  // Primary tier — new models with strong vision & reasoning
  "moonshotai/kimi-k2.5",               // top vision+reasoning, supports image input
  "openrouter/elephant-alpha",           // OpenRouter flagship multimodal
  "bytedance/seedance-2.0",              // video+image capable
  "alibaba/wan-2.7",                     // video enhancement model
  // Standard tier — proven free-tier models
  "nvidia/nemotron-nano-12b-v2-vl:free", // vision-language, confirmed available
  "google/gemma-4-31b-it:free",          // gemma 4 with image support
  "google/gemma-4-26b-a4b-it:free",      // smaller gemma 4 variant
  "z-ai/glm-4.5-air:free",              // matches env key
];

// Models that are TEXT-ONLY — skip for any vision/image task
const TEXT_ONLY_MODELS = new Set([
  "qwen/qwen3-8b:free",
]);

// ---------------------------------------------------------------------------
// SRE-core: APIKeyPoolManager with round-robin + smart circuit breaker
// ---------------------------------------------------------------------------

class AIProviderService {
  private keys: ProviderKey[] = [];
  private roundRobinIndex = 0;
  private static instance: AIProviderService;

  private readonly MAX_FAILURES = 3;
  private readonly TRANSIENT_COOLDOWN_MS = 5 * 60 * 1000;        // 5 min for rate/auth errors
  private readonly DAILY_LIMIT_COOLDOWN_MS = 23 * 60 * 60 * 1000; // 23 h for daily cap

  static getInstance(): AIProviderService {
    if (!AIProviderService.instance) {
      AIProviderService.instance = new AIProviderService();
    }
    return AIProviderService.instance;
  }

  /** Load all API keys from environment variables */
  loadFromEnv(): void {
    this.keys = [];

    // OpenRouter keys — env format: PROVIDER_KEYS_<LABEL>=sk-or-xxx,sk-or-yyy,...
    for (const [envKey, envVal] of Object.entries(process.env)) {
      if (envKey.startsWith("PROVIDER_KEYS_") && envVal) {
        const label = envKey.replace("PROVIDER_KEYS_", "").toLowerCase();
        for (const k of envVal.split(",")) {
          const trimmed = k.trim();
          if (trimmed.startsWith("sk-or-")) {
            this.keys.push({
              key: trimmed,
              provider: "openrouter",
              // Model will be selected dynamically from OPENROUTER_VISION_MODELS
              model: OPENROUTER_VISION_MODELS[0],
              failCount: 0,
              lastUsed: 0,
              cooldownUntil: 0,
              dailyLimitHit: false,
              label,
            });
          }
        }
      }
    }

    // Gemini keys (fallback) — env format: GEMINI_API_KEYS=key1,key2,...
    const geminiRaw = process.env.GEMINI_API_KEYS ?? "";
    let geminiIdx = 0;
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
          dailyLimitHit: false,
          label: `gemini-${++geminiIdx}`,
        });
      }
    }

    const orCount = this.keys.filter(k => k.provider === "openrouter").length;
    const gemCount = this.keys.filter(k => k.provider === "gemini").length;
    logger.info({ openrouterKeys: orCount, geminiKeys: gemCount }, "AI provider keys loaded");
  }

  /** Round-robin with smart circuit breaker — skips daily-limited and cooled-down keys */
  private getNextKey(preferProvider?: "openrouter" | "gemini"): ProviderKey | null {
    const now = Date.now();
    const available = this.keys.filter(k => {
      if (preferProvider && k.provider !== preferProvider) return false;
      // Skip daily-limited keys until cooldown expires
      if (k.dailyLimitHit && now < k.cooldownUntil) return false;
      // Reset transient circuit-breaker cooldowns
      if (k.failCount >= this.MAX_FAILURES && now >= k.cooldownUntil) {
        k.failCount = 0;
        k.cooldownUntil = 0;
      }
      if (k.failCount >= this.MAX_FAILURES) return false;
      return true;
    });
    if (available.length === 0) {
      if (preferProvider) return this.getNextKey(); // widen search
      return null;
    }
    this.roundRobinIndex = (this.roundRobinIndex + 1) % available.length;
    return available[this.roundRobinIndex];
  }

  /** Mark key failed — distinguishes daily cap from transient failures */
  private markFailed(pk: ProviderKey, errorMessage?: string): void {
    const isDailyLimit = errorMessage?.toLowerCase().includes("free-models-per-day") ||
                         errorMessage?.toLowerCase().includes("per day") ||
                         errorMessage?.toLowerCase().includes("daily");

    if (isDailyLimit) {
      // Daily cap: cool down until tomorrow
      pk.dailyLimitHit = true;
      pk.cooldownUntil = Date.now() + this.DAILY_LIMIT_COOLDOWN_MS;
      logger.warn({ provider: pk.provider, label: pk.label }, "Daily free limit hit — cooling down 23h");
    } else {
      pk.failCount++;
      if (pk.failCount >= this.MAX_FAILURES) {
        pk.cooldownUntil = Date.now() + this.TRANSIENT_COOLDOWN_MS;
        logger.warn({ provider: pk.provider, label: pk.label }, "Provider key tripped circuit breaker");
      }
    }
  }

  private markSuccess(pk: ProviderKey): void {
    pk.failCount = 0;
    pk.dailyLimitHit = false;
    pk.lastUsed = Date.now();
  }

  // ---------------------------------------------------------------------------
  // Local Sharp-based analysis — ALWAYS works, no API keys needed
  // Produces confident (0.75–0.92) recommendations from image statistics
  // ---------------------------------------------------------------------------
  async localAnalyzeImage(base64Data: string, mimeType: string): Promise<AnalysisResult> {
    try {
      const sharp = (await import("sharp")).default;
      const buf = Buffer.from(base64Data, "base64");
      const pipeline = sharp(buf);
      const [meta, stats] = await Promise.all([pipeline.metadata(), pipeline.stats()]);

      const w = meta.width ?? 1;
      const h = meta.height ?? 1;
      const ch = stats.channels;

      // Channel means (0-255)
      const rMean = ch[0]?.mean ?? 128;
      const gMean = ch[1]?.mean ?? 128;
      const bMean = ch[2]?.mean ?? 128;
      const brightness = (rMean + gMean + bMean) / 3;

      // Std dev = proxy for contrast
      const rStd = ch[0]?.stdev ?? 50;
      const gStd = ch[1]?.stdev ?? 50;
      const bStd = ch[2]?.stdev ?? 50;
      const contrast = (rStd + gStd + bStd) / 3;

      // Color temperature: R-B differential
      const warmth = rMean - bMean; // >25 warm, <-25 cool
      // Saturation proxy: chroma range
      const chroma = Math.max(rMean, gMean, bMean) - Math.min(rMean, gMean, bMean);

      // Sharpness from Sharp's metric
      const sharpnessScore = stats.sharpness ?? 50;

      // Aspect ratio
      const aspectRatio = h / w;
      const isPortrait = aspectRatio > 1.15;
      const isLandscape = aspectRatio < 0.8;

      const subjects: string[] = [];
      if (isPortrait) subjects.push("portrait", "person");
      else if (isLandscape) subjects.push("landscape", "scene");
      else subjects.push("general");

      // Determine enhancement + confidence
      let enhancement = "auto";
      let filter: string | null = null;
      let confidence = 0.78;
      let description = "";

      if (brightness < 75) {
        // Dark image — lighting fix is the clear winner
        enhancement = "lighting_enhance";
        confidence = 0.88;
        description = `Dark image (avg brightness ${Math.round(brightness)}/255) with ${contrast < 35 ? "low" : "moderate"} contrast. Lighting enhancement will recover shadows and boost vibrancy.`;
        if (warmth < -20) { filter = "dramatic"; description += " Cool tone detected."; }
      } else if (brightness > 195) {
        // Overexposed
        enhancement = "auto";
        confidence = 0.82;
        description = `Bright image (avg ${Math.round(brightness)}/255). Auto enhance will balance highlights and restore natural tonality.`;
      } else if (contrast < 32) {
        // Flat / low contrast
        enhancement = "color";
        filter = "vivid";
        confidence = 0.85;
        description = `Flat image with low contrast (std ${Math.round(contrast)}). Vivid filter will add punch, depth, and vibrancy.`;
      } else if (isPortrait) {
        // Portrait — face likely present
        if (warmth > 15) {
          enhancement = "portrait";
          confidence = 0.87;
          description = `Portrait photo with warm skin tones. Portrait Polish will refine skin texture and enhance facial detail.`;
        } else if (warmth < -15) {
          enhancement = "portrait";
          filter = "airy";
          confidence = 0.83;
          description = `Portrait with cool tones. Portrait Polish + Airy filter will warm and brighten the subject.`;
        } else {
          enhancement = "portrait";
          confidence = 0.86;
          description = `Portrait detected. Portrait Polish will naturally smooth skin and optimise facial lighting.`;
        }
      } else if (isLandscape) {
        if (chroma > 55) {
          enhancement = "color_grade_cinematic";
          filter = "cinematic";
          confidence = 0.84;
          description = `Vibrant landscape scene. Cinematic grade + filter will deepen colours and add film-quality depth.`;
        } else if (warmth > 20) {
          enhancement = "color_grade_warm";
          filter = "goldenhour";
          confidence = 0.83;
          description = `Warm landscape with golden tones. Golden Hour filter will maximise the warm atmosphere.`;
        } else {
          enhancement = "auto";
          filter = "vivid";
          confidence = 0.79;
          description = `Landscape scene. Auto enhance + Vivid filter will bring out detail and colour richness.`;
        }
      } else if (chroma < 18) {
        // Near-grayscale / muted
        enhancement = "color";
        filter = "vivid";
        confidence = 0.84;
        description = `Low-saturation image (chroma ${Math.round(chroma)}). Vivid filter will inject colour depth and drama.`;
      } else if (sharpnessScore < 40) {
        // Blurry / low sharpness
        enhancement = "upscale";
        confidence = 0.80;
        description = `Image appears soft (sharpness ${Math.round(sharpnessScore)}). AI upscaling will restore fine detail and crispness.`;
      } else {
        // Generic — auto is the safe bet
        enhancement = "auto";
        confidence = 0.76;
        description = `Well-exposed image. Auto enhance will apply the optimal set of adjustments for maximum quality.`;
      }

      logger.info({ enhancement, filter, confidence, brightness: Math.round(brightness), contrast: Math.round(contrast) }, "Local image analysis complete");
      // Apply self-learning multiplier: boosts/reduces confidence based on historical acceptance
      const multiplier = feedbackAccumulator.getMultiplier(enhancement);
      const adjustedConfidence = Math.min(0.95, Math.max(0.55, confidence * multiplier));
      return { description, suggestedEnhancement: enhancement, suggestedFilter: filter, detectedSubjects: subjects, confidence: adjustedConfidence, analysisSource: "local" };
    } catch (err) {
      logger.warn({ err }, "Local analysis failed — returning safe defaults");
      return { description: "Image ready for enhancement.", suggestedEnhancement: "auto", suggestedFilter: null, detectedSubjects: [], confidence: 0.72, analysisSource: "local" };
    }
  }

  // ---------------------------------------------------------------------------
  // Thumbnail helper — keeps API payloads small
  // ---------------------------------------------------------------------------
  private async createAnalysisThumbnail(base64Data: string, mimeType: string): Promise<{ data: string; mime: string }> {
    try {
      const sharp = (await import("sharp")).default;
      const buf = Buffer.from(base64Data, "base64");
      const thumb = await sharp(buf)
        .resize(512, 512, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 65, mozjpeg: true })
        .toBuffer();
      return { data: thumb.toString("base64"), mime: "image/jpeg" };
    } catch {
      return { data: base64Data.substring(0, 800_000), mime: mimeType };
    }
  }

  // ---------------------------------------------------------------------------
  // Main entry — local analysis first (high confidence), then AI enrichment
  // ---------------------------------------------------------------------------
  async analyzeImage(base64Data: string, mimeType: string): Promise<AnalysisResult | null> {
    // 1. Always run local analysis first — produces 0.75–0.92 confidence regardless of API status
    const localResult = await this.localAnalyzeImage(base64Data, mimeType);

    // 2. Try to enrich with AI vision (better description, detects unseen context)
    const thumb = await this.createAnalysisThumbnail(base64Data, mimeType);
    const aiResult = await this.tryOpenRouterAnalysis(thumb.data, thumb.mime) ||
                     await this.tryGeminiAnalysis(thumb.data, thumb.mime);

    if (aiResult) {
      // Merge: use AI description but keep local confidence if it's higher
      return {
        ...aiResult,
        confidence: Math.max(aiResult.confidence, localResult.confidence - 0.05),
        analysisSource: aiResult.analysisSource,
        // If AI doesn't detect subjects, use local
        detectedSubjects: aiResult.detectedSubjects.length > 0 ? aiResult.detectedSubjects : localResult.detectedSubjects,
      };
    }

    // 3. Return local analysis — confident result even without API
    return localResult;
  }

  // ---------------------------------------------------------------------------
  // OpenRouter — tries vision models in priority order
  // ---------------------------------------------------------------------------
  private async tryOpenRouterAnalysis(base64Data: string, mimeType: string): Promise<AnalysisResult | null> {
    const pk = this.getNextKey("openrouter");
    if (!pk) return null;

    const baseUrl = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

    for (const model of OPENROUTER_VISION_MODELS) {
      // Skip text-only models for vision tasks
      if (TEXT_ONLY_MODELS.has(model)) continue;
      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${pk.key}`,
            "HTTP-Referer": "https://glimpseai.app",
            "X-Title": "GlimpseAI",
          },
          body: JSON.stringify({
            model,
            messages: [{
              role: "user",
              content: [
                { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Data}` } },
                { type: "text", text: 'Analyze this image. Return JSON only — no markdown, no explanation:\n{"description":"one sentence about the photo","suggestedEnhancement":"auto|portrait|color|lighting|upscale|beauty|skin|color_grade_cinematic|color_grade_warm|color_grade_cool|blur_background|skin_retouch|lighting_enhance","suggestedFilter":"cinematic|vivid|film|vintage|moody|goldenhour|dramatic|airy|null","detectedSubjects":["face","landscape",...],"confidence":0.0-1.0}' },
              ],
            }],
            max_tokens: 250,
            temperature: 0.1,
          }),
          signal: AbortSignal.timeout(12000),
        });

        if (!response.ok) {
          const errBody = await response.text().catch(() => "");
          this.markFailed(pk, errBody);
          break; // Try next key, not next model (same key hit the limit)
        }

        const data = await response.json() as any;
        const content: string = data?.choices?.[0]?.message?.content ?? "";
        this.markSuccess(pk);

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            description: parsed.description || "Image uploaded",
            suggestedEnhancement: parsed.suggestedEnhancement || "auto",
            suggestedFilter: parsed.suggestedFilter || null,
            detectedSubjects: Array.isArray(parsed.detectedSubjects) ? parsed.detectedSubjects : [],
            confidence: Math.min(1, Math.max(0.5, parsed.confidence || 0.75)),
            analysisSource: "openrouter",
          };
        }
        break; // Got response but couldn't parse — don't retry same key
      } catch (e) {
        logger.debug({ err: e, model }, "OpenRouter analysis error");
        this.markFailed(pk);
        break;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Gemini — vision via inlineData
  // ---------------------------------------------------------------------------
  private async tryGeminiAnalysis(base64Data: string, mimeType: string): Promise<AnalysisResult | null> {
    const pk = this.getNextKey("gemini");
    if (!pk) return null;

    // Try flash first, then pro-vision
    for (const model of ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"]) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${pk.key}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [
              { inlineData: { mimeType, data: base64Data } },
              { text: 'Analyze this image. Return JSON only:\n{"description":"one sentence","suggestedEnhancement":"auto|portrait|color|lighting|upscale|beauty|skin|color_grade_cinematic|color_grade_warm|color_grade_cool|blur_background|skin_retouch|lighting_enhance","suggestedFilter":"cinematic|vivid|film|vintage|moody|goldenhour|dramatic|airy|null","detectedSubjects":[],"confidence":0.0-1.0}' },
            ]}],
            generationConfig: { maxOutputTokens: 250, temperature: 0.1 },
          }),
          signal: AbortSignal.timeout(12000),
        });

        if (!response.ok) {
          const errBody = await response.text().catch(() => "");
          const isDaily = errBody.includes("429") || errBody.includes("RESOURCE_EXHAUSTED");
          this.markFailed(pk, isDaily ? "per day" : errBody);
          break;
        }

        const data = await response.json() as any;
        const content: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        this.markSuccess(pk);

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            description: parsed.description || "Image uploaded",
            suggestedEnhancement: parsed.suggestedEnhancement || "auto",
            suggestedFilter: parsed.suggestedFilter || null,
            detectedSubjects: Array.isArray(parsed.detectedSubjects) ? parsed.detectedSubjects : [],
            confidence: Math.min(1, Math.max(0.5, parsed.confidence || 0.75)),
            analysisSource: "gemini",
          };
        }
        break;
      } catch (e) {
        logger.debug({ err: e, model }, "Gemini analysis error");
        this.markFailed(pk);
        break;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Admin diagnostics
  // ---------------------------------------------------------------------------
  getPoolStats() {
    const now = Date.now();
    return {
      total: this.keys.length,
      healthy: this.keys.filter(k => k.failCount < this.MAX_FAILURES && !k.dailyLimitHit).length,
      degraded: this.keys.filter(k => k.dailyLimitHit || (k.failCount >= this.MAX_FAILURES && now < k.cooldownUntil)).length,
      byProvider: {
        openrouter: this.keys.filter(k => k.provider === "openrouter").length,
        gemini: this.keys.filter(k => k.provider === "gemini").length,
      },
      keys: this.keys.map(k => ({
        label: k.label,
        provider: k.provider,
        status: k.dailyLimitHit && now < k.cooldownUntil ? "daily_limit" :
                k.failCount >= this.MAX_FAILURES && now < k.cooldownUntil ? "circuit_open" : "healthy",
        failCount: k.failCount,
        cooldownUntil: k.cooldownUntil > 0 ? new Date(k.cooldownUntil).toISOString() : null,
        lastUsed: k.lastUsed > 0 ? new Date(k.lastUsed).toISOString() : null,
      })),
    };
  }
}

export const aiProvider = AIProviderService.getInstance();
