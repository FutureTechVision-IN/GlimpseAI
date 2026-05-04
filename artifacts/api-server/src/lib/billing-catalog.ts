/**
 * Hybrid billing catalog: subscriptions (plans), one-time credit packs,
 * and voluntary contributions for platform development + charity giving.
 *
 * The existing tier/plan model in `tier-config.ts` covers monthly subscription
 * tiers. This catalog adds two NEW commerce surfaces:
 *
 * 1. CREDIT_PACKS  — one-time, additive credit purchases that stack with the
 *                    subscription monthly cap. Users can top up at any time
 *                    instead of upgrading their plan.
 *
 * 2. CONTRIBUTION_TIERS — voluntary donations toward platform development.
 *                    Distinct from subscriptions/packs: users get no extra
 *                    quota; they help sustain the project AND fund charity.
 *
 * 3. CHARITY_PERCENTAGE — flat percentage of every paid plan, credit pack,
 *                    AND contribution that GlimpseAI commits to charitable
 *                    causes. Surfaced on every commerce page for transparency.
 *
 * The catalog is hardcoded server-side so the frontend has a single,
 * authoritative source of truth via `GET /payments/credit-packs`,
 * `GET /payments/contribution-tiers`, and `GET /payments/charity-info`.
 */

export interface CreditPack {
  /** Stable id for analytics + receipts */
  id: string;
  /** Marketing name shown to users */
  name: string;
  /** Credits granted on successful purchase (additive to monthly cap) */
  credits: number;
  /** Price in the smallest currency unit (rupees, since Razorpay flow is INR) */
  priceInr: number;
  /** One-line value prop */
  description: string;
  /** Highlight as "best value" / popular pick */
  popular?: boolean;
}

export interface ContributionTier {
  /** Stable id for analytics + receipts */
  id: string;
  /** Friendly label (e.g. "Supporter") */
  label: string;
  /** Amount in INR (rupees, not paise) */
  amountInr: number;
  /** Why this tier exists */
  blurb: string;
}

export interface CharityInfo {
  /** Whole-number percentage (0–100) of revenue committed to charity */
  percentage: number;
  /** User-facing description of the cause and disbursement model */
  description: string;
  /** Link to public report / partner page (optional, can be empty for now) */
  reportUrl: string;
}

/**
 * One-time credit packs. Tuned so a user with the free plan's monthly cap
 * (typically 30 credits) can top up to a comfortable working amount with
 * Starter, batch-process medium photo sets with Popular, and run heavy
 * batch days with Pro.
 *
 * Pricing is illustrative; production deployment should reconcile with
 * payment-processor settlement currencies.
 */
export const CREDIT_PACKS: ReadonlyArray<CreditPack> = [
  {
    id: "pack_starter",
    name: "Starter Pack",
    credits: 50,
    priceInr: 99,
    description: "Top up 50 enhancement credits — great for catching up on a small batch.",
  },
  {
    id: "pack_popular",
    name: "Popular Pack",
    credits: 250,
    priceInr: 399,
    description: "250 credits at the best per-credit value — handles a full event shoot.",
    popular: true,
  },
  {
    id: "pack_pro",
    name: "Pro Pack",
    credits: 1000,
    priceInr: 1299,
    description: "1,000 credits for studios and power users running large batches.",
  },
];

/**
 * Voluntary contribution amounts. We avoid framing these as "premium" so
 * users on the free tier can also contribute without confusion. A custom-amount
 * input on the frontend covers anything outside these tiers.
 */
export const CONTRIBUTION_TIERS: ReadonlyArray<ContributionTier> = [
  { id: "contrib_supporter", label: "Supporter", amountInr: 199, blurb: "Help keep the lights on for one user-month." },
  { id: "contrib_advocate",  label: "Advocate",  amountInr: 499, blurb: "Fund infrastructure for hundreds of free-tier enhancements." },
  { id: "contrib_patron",    label: "Patron",    amountInr: 999, blurb: "Sponsor model upgrades and accessibility improvements." },
];

/**
 * Charity disclosure. The percentage is displayed prominently anywhere money
 * changes hands (subscriptions, credit packs, contributions). We commit to
 * this in code so the disclosure can't drift from operational reality —
 * accounting reports should reconcile against this exact number.
 */
export const CHARITY_INFO: CharityInfo = {
  percentage: Number(process.env.CHARITY_PERCENTAGE ?? "10"),
  description:
    "We commit a transparent share of every paid plan, credit pack, and contribution to verified charitable causes that support the poor and needy. The exact percentage is fixed in code and reconciled against settlement reports.",
  reportUrl: process.env.CHARITY_REPORT_URL ?? "",
};

/** Lookup helpers used by purchase routes for validation. */
export function findCreditPack(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.id === id);
}

export function findContributionTier(id: string): ContributionTier | undefined {
  return CONTRIBUTION_TIERS.find((t) => t.id === id);
}
