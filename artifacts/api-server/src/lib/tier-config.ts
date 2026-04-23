import { PREMIUM_FILTER_IDS } from "@workspace/filter-registry";

/**
 * Tier-based feature gating configuration.
 *
 * Maps plan slugs to allowed enhancement types, filter access, and capabilities.
 * Used by the enhance endpoint to reject disallowed features with a clear error.
 */

export type PlanSlug = "free" | "basic" | "premium";

export interface TierCapabilities {
  /** Enhancement types this tier can access */
  allowedEnhancements: Set<string>;
  /** Whether premium filters (airy, teal_orange, pastel, etc.) are available */
  premiumFilters: boolean;
  /** Maximum upscale level: 2 = 2x only, 4 = up to 4x */
  maxUpscale: 2 | 4;
  /** Whether posture adjustment is available */
  postureAdjust: boolean;
  /** Whether fine-tuned sliders (advanced mode) are sent to server */
  fineTunedEdits: boolean;
  /** Whether this tier gets priority processing (future queue priority) */
  priorityProcessing: boolean;
  /** Whether video enhancement is available */
  videoEnhance: boolean;
}

// Base enhancement types available to all tiers
const BASE_ENHANCEMENTS = [
  "auto", "portrait", "lighting_enhance", "color",
  "color_grade_cinematic", "color_grade_warm", "color_grade_cool",
  "blur_background", "skin_retouch", "beauty", "filter",
  "background", "lighting", "skin", "custom",
];

const BASIC_EXTRAS = [
  "upscale", // 2x
  "stabilize", "trim", // video features
];

const PREMIUM_EXTRAS = [
  "upscale", "upscale_4x",
  "posture",
  "stabilize", "trim",
  // AI Restoration (GFPGAN + CodeFormer + Real-ESRGAN)
  "face_restore", "face_restore_hd",
  "codeformer", "auto_face",
  "esrgan_upscale_2x", "esrgan_upscale_4x",
  "old_photo_restore", "video_restore",
];

const TIER_MAP: Record<PlanSlug, TierCapabilities> = {
  free: {
    allowedEnhancements: new Set([...BASE_ENHANCEMENTS, "upscale"]),
    premiumFilters: false,
    maxUpscale: 2,
    postureAdjust: false,
    fineTunedEdits: false,
    priorityProcessing: false,
    videoEnhance: false,
  },
  basic: {
    allowedEnhancements: new Set([...BASE_ENHANCEMENTS, ...BASIC_EXTRAS]),
    premiumFilters: true,
    maxUpscale: 2,
    postureAdjust: false,
    fineTunedEdits: false,
    priorityProcessing: false,
    videoEnhance: true,
  },
  premium: {
    allowedEnhancements: new Set([...BASE_ENHANCEMENTS, ...PREMIUM_EXTRAS]),
    premiumFilters: true,
    maxUpscale: 4,
    postureAdjust: true,
    fineTunedEdits: true,
    priorityProcessing: true,
    videoEnhance: true,
  },
};

/** Premium filter keys that require basic+ tier */
export const PREMIUM_FILTER_KEYS = PREMIUM_FILTER_IDS;

/**
 * Resolve a plan slug from a planId.
 * - null/0 → "free"
 * - Admin users always get "premium" capabilities
 */
export function resolvePlanSlug(planSlug: string | null | undefined, isAdmin: boolean): PlanSlug {
  if (isAdmin) return "premium";
  if (!planSlug) return "free";
  if (planSlug === "basic" || planSlug === "premium") return planSlug;
  // Unknown plan slugs default to basic (safest)
  return "basic";
}

/** Get capabilities for a given tier */
export function getTierCapabilities(slug: PlanSlug): TierCapabilities {
  return TIER_MAP[slug];
}

/**
 * Check if an enhancement type is allowed for the given tier.
 * Returns null if allowed, or an error message string if blocked.
 */
export function checkTierAccess(
  slug: PlanSlug,
  enhancementType: string,
  filterName?: string,
): string | null {
  const cap = TIER_MAP[slug];

  if (!cap.allowedEnhancements.has(enhancementType)) {
    if (enhancementType === "upscale_4x") {
      return "4× upscaling is a Premium feature. Upgrade to Premium to unlock ultra-high resolution.";
    }
    if (enhancementType === "posture") {
      return "Posture adjustment is a Premium feature. Upgrade to Premium to access AI-powered pose correction.";
    }
    if (enhancementType === "stabilize" || enhancementType === "trim") {
      return "Video editing requires a Basic or Premium plan.";
    }
    if (enhancementType === "face_restore" || enhancementType === "face_restore_hd") {
      return "AI Face Restoration is a Premium feature. Upgrade to Premium to restore faces with GFPGAN.";
    }
    if (enhancementType === "codeformer") {
      return "CodeFormer face restoration is a Premium feature. Upgrade to Premium for superior degraded face recovery.";
    }
    if (enhancementType === "auto_face") {
      return "Auto Face Restoration is a Premium feature. Upgrade to Premium for AI-powered face analysis and restoration.";
    }
    if (enhancementType === "esrgan_upscale_2x" || enhancementType === "esrgan_upscale_4x") {
      return "AI Super-Resolution (Real-ESRGAN) is a Premium feature. Upgrade to Premium.";
    }
    if (enhancementType === "old_photo_restore") {
      return "Old Photo Restoration is a Premium feature. Upgrade to Premium.";
    }
    if (enhancementType === "video_restore") {
      return "AI Video Restoration is a Premium feature. Upgrade to Premium.";
    }
    return `${enhancementType} requires a higher-tier plan.`;
  }

  // Check premium filter access
  if (enhancementType === "filter" && filterName && PREMIUM_FILTER_KEYS.has(filterName)) {
    if (!cap.premiumFilters) {
      return `The "${filterName}" filter is available on Basic and Premium plans. Upgrade to access premium filters.`;
    }
  }

  return null;
}
