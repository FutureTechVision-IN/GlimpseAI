import React from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Zap, Calendar, TrendingUp, Gift, Crown, Clock } from "lucide-react";

/**
 * Shape of /users/usage. The route returns extra fields beyond the
 * generated `UserUsage` type — typing them locally keeps the component
 * decoupled from the (currently drifting) generated schema.
 */
export interface UsageSnapshot {
  creditsUsed: number;
  creditsLimit: number;
  creditsRemaining: number;
  dailyCreditsUsed: number;
  dailyLimit: number;
  dailyRemaining: number;
  dailyResetAt?: string | null;
  planName: string | null;
  planSlug?: string | null;
  planExpiry?: string | null;
  planMonthlyCredits?: number | null;
  bonusCredits?: number;
  trialActive?: boolean;
  trialEndsAt?: string | null;
  trialDaysRemaining?: number;
}

interface UsageSummaryProps {
  usage: UsageSnapshot | undefined;
  isLoading?: boolean;
  /** When true, hides the inline action buttons (use on the billing page itself). */
  compact?: boolean;
}

function pct(used: number, limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}

function formatRelativeReset(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const diffMs = t - Date.now();
  if (diffMs <= 0) return "any moment";
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours < 1) return "less than 1 hour";
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.ceil(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Compact summary card showing the user's current commerce state in one place:
 *   - Plan name + (if active) trial countdown
 *   - Daily limit used / remaining + reset countdown
 *   - Monthly limit used / remaining
 *   - Bonus credits from one-time packs
 * Plus action buttons to upgrade (subscriptions) or top up (credit packs).
 *
 * Used by:
 *   - dashboard.tsx (always visible)
 *   - billing.tsx (header card; uses `compact` to hide redundant CTAs)
 */
export function UsageSummary({ usage, isLoading, compact = false }: UsageSummaryProps): React.ReactElement {
  if (isLoading || !usage) {
    return (
      <Card className="bg-zinc-950 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-base">Usage Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-24 flex items-center justify-center">
            <div className="w-5 h-5 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const planLabel = usage.planName ?? "Free";
  const trialActive = Boolean(usage.trialActive);
  const trialDays = usage.trialDaysRemaining ?? 0;
  const bonus = usage.bonusCredits ?? 0;
  const monthlyPct = pct(usage.creditsUsed, usage.creditsLimit);
  const dailyPct = pct(usage.dailyCreditsUsed, usage.dailyLimit);
  const dailyResetIn = formatRelativeReset(usage.dailyResetAt);

  return (
    <Card className="bg-zinc-950 border-zinc-800">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-teal-400" /> Usage Summary
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={
                trialActive
                  ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
                  : "border-teal-500/50 bg-teal-500/10 text-teal-300"
              }
            >
              <Crown className="w-3 h-3 mr-1" />
              {planLabel}
            </Badge>
            {trialActive && (
              <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 text-amber-200">
                <Clock className="w-3 h-3 mr-1" />
                Trial · {trialDays}d left
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Daily quota */}
        <div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-300 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-zinc-400" /> Daily
            </span>
            <span className="font-mono text-zinc-200">
              {usage.dailyCreditsUsed} / {usage.dailyLimit > 0 ? usage.dailyLimit : "∞"}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className={`h-full ${dailyPct >= 90 ? "bg-red-500" : dailyPct >= 70 ? "bg-amber-500" : "bg-teal-500"}`}
              style={{ width: `${dailyPct}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {usage.dailyLimit > 0
              ? `Resets in ${dailyResetIn ?? "less than a day"}.`
              : "No daily cap on this plan."}
          </div>
        </div>

        {/* Monthly quota */}
        <div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-300 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-zinc-400" /> Monthly
            </span>
            <span className="font-mono text-zinc-200">
              {usage.creditsUsed} / {usage.creditsLimit}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className={`h-full ${monthlyPct >= 90 ? "bg-red-500" : monthlyPct >= 70 ? "bg-amber-500" : "bg-teal-500"}`}
              style={{ width: `${monthlyPct}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {usage.creditsRemaining} credits remaining this month.
          </div>
        </div>

        {/* Bonus credits from packs */}
        <div className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2">
          <div className="flex items-center gap-2">
            <Gift className="w-4 h-4 text-fuchsia-400" />
            <div className="text-sm">
              <div className="text-zinc-200">Bonus credits</div>
              <div className="text-xs text-zinc-500">
                From one-time credit packs (stack on top of your plan).
              </div>
            </div>
          </div>
          <span className="font-mono text-zinc-100">{bonus}</span>
        </div>

        {/* Action buttons (skipped on the billing page itself) */}
        {!compact && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Link href="/pricing">
              <Button size="sm" variant="outline" className="border-teal-500/50 text-teal-300 hover:bg-teal-500/10">
                Upgrade plan
              </Button>
            </Link>
            <Link href="/billing">
              <Button size="sm" variant="outline" className="border-fuchsia-500/50 text-fuchsia-300 hover:bg-fuchsia-500/10">
                Buy credit pack
              </Button>
            </Link>
            <Link href="/billing">
              <Button size="sm" variant="ghost" className="text-zinc-400 hover:text-zinc-200">
                Make a contribution
              </Button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Friendly description for a quota error, used by toast handlers. */
export function describeQuotaError(opts: {
  code?: string;
  quotaType?: string;
  message?: string;
}): { title: string; description: string; ctaLabel: string; ctaHref: string } {
  const { code, quotaType, message } = opts;

  if (code === "TIER_RESTRICTED") {
    return {
      title: "Plan upgrade needed",
      description: message ?? "This feature is available on a higher-tier plan.",
      ctaLabel: "View plans",
      ctaHref: "/pricing",
    };
  }
  if (code === "BATCH_LIMIT") {
    return {
      title: "Batch size limit reached",
      description: message ?? "Reduce the number of files or upgrade for a larger batch allowance.",
      ctaLabel: "View plans",
      ctaHref: "/pricing",
    };
  }
  if (code === "QUOTA_EXCEEDED" && quotaType === "daily") {
    return {
      title: "Daily limit reached",
      description: message ?? "You've used your daily allowance. It resets at the start of the next day, or buy a credit pack to keep going.",
      ctaLabel: "Buy credit pack",
      ctaHref: "/billing",
    };
  }
  if (code === "QUOTA_EXCEEDED" && quotaType === "monthly") {
    return {
      title: "Monthly credits exhausted",
      description: message ?? "Your monthly credits are used up. Upgrade your plan or top up with a one-time credit pack.",
      ctaLabel: "Upgrade or top up",
      ctaHref: "/billing",
    };
  }
  if (code === "QUOTA_EXCEEDED") {
    return {
      title: "Free trial usage exhausted",
      description: message ?? "You've reached your trial allowance. Choose a plan or buy a credit pack to continue.",
      ctaLabel: "Choose a plan",
      ctaHref: "/pricing",
    };
  }
  return {
    title: "Request blocked",
    description: message ?? "Something prevented this request from completing.",
    ctaLabel: "Open billing",
    ctaHref: "/billing",
  };
}
