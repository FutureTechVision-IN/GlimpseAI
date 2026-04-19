import { logger } from "./logger";
import { type ApiFailureCause } from "./api-errors";

// ---------------------------------------------------------------------------
// Fetch timeout helper — avoids Node.js undici "Headers Timeout Error" that
// occurs with AbortSignal.timeout().  Uses AbortController + setTimeout which
// gives a clean abort without socket-level race conditions.
// ---------------------------------------------------------------------------
function fetchWithTimeout(url: string, init: RequestInit & { timeout?: number }): Promise<Response> {
  const { timeout = 12000, ...fetchInit } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...fetchInit, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProviderKey {
  key: string;
  provider: "openrouter" | "gemini" | "nvidia";
  model: string;
  failCount: number;
  lastUsed: number;
  cooldownUntil: number;
  dailyLimitHit: boolean;  // free-tier daily cap exhausted
  label: string;           // human-readable key label for diagnostics
}

export type UserTier = "free" | "premium";

export interface AnalysisResult {
  description: string;
  suggestedEnhancement: string;
  suggestedFilter: string | null;
  detectedSubjects: string[];
  confidence: number;
  analysisSource: "local" | "openrouter" | "gemini" | "nvidia";  // which engine produced this
  /** Set when AI call failed — only populated with cause info, never raw key data */
  failureCause?: ApiFailureCause;
}

/**
 * AI-generated numerical guidance for the Sharp enhancement pipeline.
 * Values are anchored: 1.0 = no change; >1 = increase; <1 = decrease.
 * null fields = "let Sharp decide" (no override).
 */
export interface AIEnhancementGuidance {
  brightness: number | null;     // 0.7 – 1.4
  contrast: number | null;       // 0.7 – 1.5
  saturation: number | null;     // 0.5 – 1.6
  sharpness: number | null;      // 0.5 – 2.5 (sigma)
  warmth: number | null;         // -30 to +30  (R-B shift)
  shadowRecovery: number | null; // 0 – 40
  highlightRecovery: number | null; // 0 – 30
  denoiseStrength: number | null; // 0 – 3 (blur sigma for denoising)
  gammaCorrection: number | null; // 0.7 – 1.5
  vignetteStrength: number | null; // 0 – 0.4
  description: string;           // human-readable explanation
  source: "openrouter" | "gemini" | "nvidia" | "local";
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
  "openai/gpt-oss-120b:free",            // large free model
  "nvidia/nemotron-3-super-120b-a12b:free", // 120b vision-language
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
// NVIDIA direct API — separate from OpenRouter, uses nvapi- keys
// ---------------------------------------------------------------------------
const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";

/** Vision-capable NVIDIA models (support image_url in messages) */
const NVIDIA_VISION_MODELS = [
  "moonshotai/kimi-k2.5",               // native multimodal agentic model
];

/** Text-only NVIDIA models (used for text guidance, not vision analysis) */
const NVIDIA_TEXT_ONLY_MODELS = new Set([
  "minimaxai/minimax-m2.5",
  "nvidia/nemotron-3-super-120b-a12b",
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

    // NVIDIA direct API keys — env format: NVIDIA_API_KEY=nvapi-xxx
    // Single key shared across all NVIDIA-hosted models
    const nvidiaKey = (process.env.NVIDIA_API_KEY ?? "").trim();
    if (nvidiaKey && nvidiaKey.startsWith("nvapi-")) {
      const allNvidiaModels = [...NVIDIA_VISION_MODELS, ...Array.from(NVIDIA_TEXT_ONLY_MODELS)];
      let nvidiaIdx = 0;
      for (const model of allNvidiaModels) {
        this.keys.push({
          key: nvidiaKey,
          provider: "nvidia",
          model,
          failCount: 0,
          lastUsed: 0,
          cooldownUntil: 0,
          dailyLimitHit: false,
          label: `nvidia-${++nvidiaIdx}`,
        });
      }
    }
    const nvCount = this.keys.filter(k => k.provider === "nvidia").length;

    logger.info({ openrouterKeys: orCount, geminiKeys: gemCount, nvidiaKeys: nvCount }, "AI provider keys loaded");
  }

  /**
   * Round-robin with smart circuit breaker and tier-aware filtering.
   *
   * Tier logic:
   *   - "free" users  → OpenRouter keys ONLY (no Gemini fallback)
   *   - "premium"     → OpenRouter first, Gemini as last resort
   *   - undefined     → legacy: all keys available (backward compat)
   */
  private getNextKey(preferProvider?: "openrouter" | "gemini" | "nvidia", userTier?: UserTier): ProviderKey | null {
    const now = Date.now();
    const available = this.keys.filter(k => {
      if (preferProvider && k.provider !== preferProvider) return false;
      // Tier restriction: free users never get Gemini keys
      if (userTier === "free" && k.provider === "gemini") return false;
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
      // Widen search: drop provider preference but keep tier restriction
      if (preferProvider) return this.getNextKey(undefined, userTier);
      return null;
    }
    this.roundRobinIndex = (this.roundRobinIndex + 1) % available.length;
    return available[this.roundRobinIndex];
  }

  /** Check if any keys are available for a given tier (used for error classification) */
  hasAvailableKeys(userTier?: UserTier): { openrouter: boolean; gemini: boolean; nvidia: boolean } {
    const now = Date.now();
    const isAvailable = (k: ProviderKey) => {
      if (k.dailyLimitHit && now < k.cooldownUntil) return false;
      if (k.failCount >= this.MAX_FAILURES && now < k.cooldownUntil) return false;
      return true;
    };
    return {
      openrouter: this.keys.some(k => k.provider === "openrouter" && isAvailable(k)),
      gemini: userTier !== "free" && this.keys.some(k => k.provider === "gemini" && isAvailable(k)),
      nvidia: this.keys.some(k => k.provider === "nvidia" && isAvailable(k)),
    };
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
  // userTier controls which provider pools are available.
  // ---------------------------------------------------------------------------
  async analyzeImage(base64Data: string, mimeType: string, userTier?: UserTier): Promise<AnalysisResult | null> {
    // 1. Always run local analysis first — produces 0.75–0.92 confidence regardless of API status
    const localResult = await this.localAnalyzeImage(base64Data, mimeType);

    // 2. Try to enrich with AI vision (better description, detects unseen context)
    const thumb = await this.createAnalysisThumbnail(base64Data, mimeType);
    const aiResult = await this.tryOpenRouterAnalysis(thumb.data, thumb.mime, userTier)
      ?? await this.tryNvidiaAnalysis(thumb.data, thumb.mime);

    // 3. Gemini fallback — only for premium users
    const geminiResult = !aiResult && userTier !== "free"
      ? await this.tryGeminiAnalysis(thumb.data, thumb.mime)
      : null;

    const bestAi = aiResult ?? geminiResult;

    if (bestAi) {
      // Merge: use AI description but keep local confidence if it's higher
      return {
        ...bestAi,
        confidence: Math.max(bestAi.confidence, localResult.confidence - 0.05),
        analysisSource: bestAi.analysisSource,
        // If AI doesn't detect subjects, use local
        detectedSubjects: bestAi.detectedSubjects.length > 0 ? bestAi.detectedSubjects : localResult.detectedSubjects,
      };
    }

    // 4. Return local analysis — confident result even without API
    // Attach failure cause if all API keys are exhausted
    if (!this.hasAvailableKeys(userTier).openrouter) {
      localResult.failureCause = userTier === "free" ? "TIER_RESTRICTED" : "ALL_KEYS_EXHAUSTED";
    }
    return localResult;
  }

  // ---------------------------------------------------------------------------
  // OpenRouter — tries vision models in priority order
  // ---------------------------------------------------------------------------
  private async tryOpenRouterAnalysis(base64Data: string, mimeType: string, userTier?: UserTier): Promise<AnalysisResult | null> {
    const pk = this.getNextKey("openrouter", userTier);
    if (!pk) return null;

    const baseUrl = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

    for (const model of OPENROUTER_VISION_MODELS) {
      // Skip text-only models for vision tasks
      if (TEXT_ONLY_MODELS.has(model)) continue;
      try {
        const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
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
          timeout: 8000,
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
      } catch (e: any) {
        const isTimeout = e?.name === "AbortError" || e?.code === "UND_ERR_HEADERS_TIMEOUT";
        logger.debug({ err: e, model, isTimeout }, "OpenRouter analysis error");
        if (!isTimeout) this.markFailed(pk);
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
        const response = await fetchWithTimeout(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [
              { inlineData: { mimeType, data: base64Data } },
              { text: 'Analyze this image. Return JSON only:\n{"description":"one sentence","suggestedEnhancement":"auto|portrait|color|lighting|upscale|beauty|skin|color_grade_cinematic|color_grade_warm|color_grade_cool|blur_background|skin_retouch|lighting_enhance","suggestedFilter":"cinematic|vivid|film|vintage|moody|goldenhour|dramatic|airy|null","detectedSubjects":[],"confidence":0.0-1.0}' },
            ]}],
            generationConfig: { maxOutputTokens: 250, temperature: 0.1 },
          }),
          timeout: 8000,
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
      } catch (e: any) {
        const isTimeout = e?.name === "AbortError" || e?.code === "UND_ERR_HEADERS_TIMEOUT";
        logger.debug({ err: e, model, isTimeout }, "Gemini analysis error");
        if (!isTimeout) this.markFailed(pk);
        break;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // NVIDIA direct — OpenAI-compatible endpoint at integrate.api.nvidia.com
  // Only kimi-k2.5 supports vision; other NVIDIA models are text-only.
  // ---------------------------------------------------------------------------
  private async tryNvidiaAnalysis(base64Data: string, mimeType: string): Promise<AnalysisResult | null> {
    const pk = this.getNextKey("nvidia");
    if (!pk) return null;

    for (const model of NVIDIA_VISION_MODELS) {
      try {
        const response = await fetchWithTimeout(`${NVIDIA_BASE}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${pk.key}`,
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
          timeout: 10000,
        });

        if (!response.ok) {
          const errBody = await response.text().catch(() => "");
          this.markFailed(pk, errBody);
          break;
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
            analysisSource: "nvidia",
          };
        }
        break;
      } catch (e: any) {
        const isTimeout = e?.name === "AbortError" || e?.code === "UND_ERR_HEADERS_TIMEOUT";
        logger.debug({ err: e, model, isTimeout }, "NVIDIA analysis error");
        if (!isTimeout) this.markFailed(pk);
        break;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // AI-Guided Enhancement — asks LLM for specific numerical processing params
  // ---------------------------------------------------------------------------
  async getEnhancementGuidance(
    base64Data: string,
    mimeType: string,
    enhancementType: string,
    userTier?: UserTier,
  ): Promise<AIEnhancementGuidance | null> {
    const thumb = await this.createAnalysisThumbnail(base64Data, mimeType);

    const prompt = `You are an expert photo editor. Analyze this image and provide EXACT numerical processing parameters for a "${enhancementType}" enhancement.

Return JSON only — no markdown, no explanation:
{"brightness":1.0,"contrast":1.0,"saturation":1.0,"sharpness":1.0,"warmth":0,"shadowRecovery":0,"highlightRecovery":0,"denoiseStrength":0,"gammaCorrection":1.0,"vignetteStrength":0,"description":"one sentence explaining what adjustments you chose and why"}

Rules:
- brightness: 0.7-1.4 (1.0 = no change)
- contrast: 0.7-1.5 (1.0 = no change)
- saturation: 0.5-1.6 (1.0 = no change)
- sharpness: 0.3-2.5 (sigma for unsharp mask, 1.0 = moderate)
- warmth: -30 to +30 (positive = warmer/redder, negative = cooler/bluer)
- shadowRecovery: 0-40 (0 = none, 40 = heavy shadow lift)
- highlightRecovery: 0-30 (0 = none, 30 = heavy highlight pull)
- denoiseStrength: 0-3 (0 = none, 3 = heavy noise reduction)
- gammaCorrection: 0.7-1.5 (1.0 = no change, >1 = lift midtones)
- vignetteStrength: 0-0.4 (0 = none)
- Be aggressive but tasteful. Each value should create a VISIBLE difference.`;

    // Try OpenRouter first, then NVIDIA direct, then Gemini (premium only)
    const result = await this.tryOpenRouterGuidance(thumb.data, thumb.mime, prompt, userTier)
      ?? await this.tryNvidiaGuidance(thumb.data, thumb.mime, prompt)
      ?? (userTier !== "free" ? await this.tryGeminiGuidance(thumb.data, thumb.mime, prompt) : null);

    if (result) {
      logger.info({
        enhancementType,
        source: result.source,
        brightness: result.brightness,
        contrast: result.contrast,
        saturation: result.saturation,
      }, "AI enhancement guidance received");
      return result;
    }

    return null;
  }

  private async tryOpenRouterGuidance(base64Data: string, mimeType: string, prompt: string, userTier?: UserTier): Promise<AIEnhancementGuidance | null> {
    const pk = this.getNextKey("openrouter", userTier);
    if (!pk) return null;

    const baseUrl = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

    for (const model of OPENROUTER_VISION_MODELS) {
      if (TEXT_ONLY_MODELS.has(model)) continue;
      try {
        const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
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
                { type: "text", text: prompt },
              ],
            }],
            max_tokens: 300,
            temperature: 0.15,
          }),
          timeout: 10000,
        });

        if (!response.ok) {
          const errBody = await response.text().catch(() => "");
          this.markFailed(pk, errBody);
          break;
        }

        const data = await response.json() as any;
        const content: string = data?.choices?.[0]?.message?.content ?? "";
        this.markSuccess(pk);

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const p = JSON.parse(jsonMatch[0]);
          return this.sanitizeGuidance(p, "openrouter");
        }
        break;
      } catch (e: any) {
        const isTimeout = e?.name === "AbortError" || e?.code === "UND_ERR_HEADERS_TIMEOUT";
        logger.debug({ err: e, model, isTimeout }, "OpenRouter guidance error");
        if (!isTimeout) this.markFailed(pk);
        break;
      }
    }
    return null;
  }

  private async tryNvidiaGuidance(base64Data: string, mimeType: string, prompt: string): Promise<AIEnhancementGuidance | null> {
    const pk = this.getNextKey("nvidia");
    if (!pk) return null;

    for (const model of NVIDIA_VISION_MODELS) {
      try {
        const response = await fetchWithTimeout(`${NVIDIA_BASE}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${pk.key}`,
          },
          body: JSON.stringify({
            model,
            messages: [{
              role: "user",
              content: [
                { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Data}` } },
                { type: "text", text: prompt },
              ],
            }],
            max_tokens: 300,
            temperature: 0.15,
          }),
          timeout: 10000,
        });

        if (!response.ok) {
          const errBody = await response.text().catch(() => "");
          this.markFailed(pk, errBody);
          break;
        }

        const data = await response.json() as any;
        const content: string = data?.choices?.[0]?.message?.content ?? "";
        this.markSuccess(pk);

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const p = JSON.parse(jsonMatch[0]);
          return this.sanitizeGuidance(p, "nvidia");
        }
        break;
      } catch (e: any) {
        const isTimeout = e?.name === "AbortError" || e?.code === "UND_ERR_HEADERS_TIMEOUT";
        logger.debug({ err: e, model, isTimeout }, "NVIDIA guidance error");
        if (!isTimeout) this.markFailed(pk);
        break;
      }
    }
    return null;
  }

  private async tryGeminiGuidance(base64Data: string, mimeType: string, prompt: string): Promise<AIEnhancementGuidance | null> {
    const pk = this.getNextKey("gemini");
    if (!pk) return null;

    for (const model of ["gemini-2.0-flash", "gemini-1.5-flash"]) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${pk.key}`;
        const response = await fetchWithTimeout(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [
              { inlineData: { mimeType, data: base64Data } },
              { text: prompt },
            ]}],
            generationConfig: { maxOutputTokens: 300, temperature: 0.15 },
          }),
          timeout: 10000,
        });

        if (!response.ok) {
          const errBody = await response.text().catch(() => "");
          this.markFailed(pk, errBody.includes("429") ? "per day" : errBody);
          break;
        }

        const data = await response.json() as any;
        const content: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        this.markSuccess(pk);

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const p = JSON.parse(jsonMatch[0]);
          return this.sanitizeGuidance(p, "gemini");
        }
        break;
      } catch (e: any) {
        const isTimeout = e?.name === "AbortError" || e?.code === "UND_ERR_HEADERS_TIMEOUT";
        logger.debug({ err: e, model, isTimeout }, "Gemini guidance error");
        if (!isTimeout) this.markFailed(pk);
        break;
      }
    }
    return null;
  }

  /** Clamp and validate AI-returned parameters to safe ranges */
  private sanitizeGuidance(raw: any, source: "openrouter" | "gemini" | "nvidia"): AIEnhancementGuidance {
    const clamp = (v: unknown, min: number, max: number, def: number | null): number | null => {
      if (v === null || v === undefined) return def;
      const n = Number(v);
      if (isNaN(n)) return def;
      return Math.max(min, Math.min(max, n));
    };
    return {
      brightness: clamp(raw.brightness, 0.7, 1.4, null),
      contrast: clamp(raw.contrast, 0.7, 1.5, null),
      saturation: clamp(raw.saturation, 0.5, 1.6, null),
      sharpness: clamp(raw.sharpness, 0.3, 2.5, null),
      warmth: clamp(raw.warmth, -30, 30, null),
      shadowRecovery: clamp(raw.shadowRecovery, 0, 40, null),
      highlightRecovery: clamp(raw.highlightRecovery, 0, 30, null),
      denoiseStrength: clamp(raw.denoiseStrength, 0, 3, null),
      gammaCorrection: clamp(raw.gammaCorrection, 0.7, 1.5, null),
      vignetteStrength: clamp(raw.vignetteStrength, 0, 0.4, null),
      description: typeof raw.description === "string" ? raw.description.slice(0, 300) : "AI-guided enhancement",
      source,
    };
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
        nvidia: this.keys.filter(k => k.provider === "nvidia").length,
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
