import React, { useEffect, useMemo, useState } from "react";
import Layout from "../components/layout";
import { useGetPaymentHistory, useGetUserUsage } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { UsageSummary, type UsageSnapshot } from "@/components/usage-summary";
import { CurrencySelector } from "@/components/currency-selector";
import { PolicyNotice } from "@/components/policy-notice";
import { apiUrl } from "@/lib/api-url";
import {
  type CurrencyCode,
  formatInDisplay,
  formatWithDisplayHint,
  readPreferredCurrency,
  writePreferredCurrency,
} from "@/lib/currency";
import { Heart, Gift, Sparkles, Loader2, ShieldCheck } from "lucide-react";

declare global {
  interface Window {
    Razorpay: any;
  }
}

interface CreditPack {
  id: string;
  name: string;
  credits: number;
  priceInr: number;
  description: string;
  popular?: boolean;
}

interface ContributionTier {
  id: string;
  label: string;
  amountInr: number;
  blurb: string;
}

interface CharityInfo {
  percentage: number;
  description: string;
  reportUrl: string;
}

const CUSTOM_AMOUNT_MIN = 50;
const CUSTOM_AMOUNT_MAX = 100_000;

async function readJson<T = Record<string, unknown>>(resp: Response): Promise<T | null> {
  try {
    const text = await resp.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Pick a user-facing message out of either the new envelope shape
 * (`{error: {userMessage, ...}}`) or the legacy `{error: "string"}` shape.
 * Never returns "[object Object]" — that's the whole point of this helper.
 */
function pickUserMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      const e = err as { userMessage?: unknown; message?: unknown };
      if (typeof e.userMessage === "string") return e.userMessage;
      if (typeof e.message === "string") return e.message;
    }
  }
  return fallback;
}

function authHeader(): Record<string, string> {
  const token = localStorage.getItem("glimpse_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Lazy-load the Razorpay Checkout script. Resolves immediately if already
 *  present (script tag is idempotent). */
function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Razorpay"));
    document.head.appendChild(s);
  });
}

export default function Billing(): React.ReactElement {
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: payments, isLoading: paymentsLoading } = useGetPaymentHistory();
  const { data: usage, isLoading: usageLoading, refetch: refetchUsage } =
    useGetUserUsage() as { data: UsageSnapshot | undefined; isLoading: boolean; refetch: () => void };

  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [tiers, setTiers] = useState<ContributionTier[]>([]);
  const [charity, setCharity] = useState<CharityInfo | null>(null);
  const [catalogLoading, setCatalogLoading] = useState<boolean>(true);
  const [busyPackId, setBusyPackId] = useState<string | null>(null);
  const [busyTierId, setBusyTierId] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [customBusy, setCustomBusy] = useState<boolean>(false);
  const [displayCurrency, setDisplayCurrency] = useState<CurrencyCode>(readPreferredCurrency());

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const [packsResp, tiersResp, charityResp] = await Promise.all([
          fetch(apiUrl("/api/payments/credit-packs")),
          fetch(apiUrl("/api/payments/contribution-tiers")),
          fetch(apiUrl("/api/payments/charity-info")),
        ]);
        const packsBody = await readJson<{ packs?: CreditPack[] }>(packsResp);
        const tiersBody = await readJson<{ tiers?: ContributionTier[] }>(tiersResp);
        const charityBody = await readJson<CharityInfo>(charityResp);
        if (cancelled) return;
        setPacks(packsBody?.packs ?? []);
        setTiers(tiersBody?.tiers ?? []);
        setCharity(charityBody);
      } catch {
        // ignore — UI will show empty states
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Persist the chosen display currency so refreshes / page navigation
   *  remember the user's preference. */
  function pickCurrency(code: CurrencyCode): void {
    setDisplayCurrency(code);
    writePreferredCurrency(code);
  }

  const charityPctText = useMemo(() => `${charity?.percentage ?? 10}%`, [charity?.percentage]);

  /** Centralized post-checkout verification. Used by both pack and donation
   *  flows so the Razorpay handler logic stays identical across surfaces. */
  async function postVerify(
    url: string,
    body: Record<string, unknown>,
    onSuccess: () => void,
    onError: (msg: string) => void,
  ): Promise<void> {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(body),
    });
    const respBody = await readJson<unknown>(resp);
    if (!resp.ok) {
      onError(pickUserMessage(respBody, `We couldn't confirm that payment (${resp.status}). Please try again.`));
      return;
    }
    onSuccess();
  }

  /** Open Razorpay Checkout for a credit pack. Falls back to a direct verify
   *  POST when keys are not configured (dev / `PAYMENT_VERIFY_DISABLED=true`). */
  async function purchasePack(pack: CreditPack): Promise<void> {
    setBusyPackId(pack.id);
    try {
      const orderResp = await fetch(apiUrl("/api/payments/credit-packs/create-order"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ packId: pack.id }),
      });
      const orderBody = await readJson<{
        orderId?: string;
        amount?: number;
        currency?: string;
        keyId?: string;
      }>(orderResp);
      if (!orderResp.ok || !orderBody?.orderId) {
        toast({
          title: "Couldn't start checkout",
          description: pickUserMessage(
            orderBody,
            "We're enhancing the payment system right now — please check back in a minute.",
          ),
          variant: "destructive",
        });
        setBusyPackId(null);
        return;
      }

      // If Razorpay keys are present, the keyId is non-test. Open Checkout.
      const isLiveCheckout = orderBody.keyId !== "rzp_test_mode" && orderBody.keyId !== "rzp_test_demo";

      if (isLiveCheckout) {
        try {
          await loadRazorpayScript();
        } catch {
          toast({
            title: "Could not load payment gateway",
            description: "Please try again or contact support.",
            variant: "destructive",
          });
          setBusyPackId(null);
          return;
        }
        const options = {
          key: orderBody.keyId,
          amount: (orderBody.amount ?? pack.priceInr) * 100,
          currency: orderBody.currency ?? "INR",
          name: "GlimpseAI",
          description: `${pack.name} — ${pack.credits} credits`,
          order_id: orderBody.orderId,
          handler: (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
            void postVerify(
              "/api/payments/purchase-credits",
              {
                packId: pack.id,
                razorpayOrderId: resp.razorpay_order_id,
                razorpayPaymentId: resp.razorpay_payment_id,
                razorpaySignature: resp.razorpay_signature,
              },
              () => {
                toast({
                  title: "Credits added",
                  description: `${pack.credits} credits granted. ${charityPctText} of every pack supports charity.`,
                });
                refetchUsage();
                setBusyPackId(null);
              },
              (msg) => {
                toast({ title: "Verification failed", description: msg, variant: "destructive" });
                setBusyPackId(null);
              },
            );
          },
          prefill: {
            name: user?.name ?? "",
            email: user?.email ?? "",
          },
          theme: { color: "#0d9488" },
          modal: { ondismiss: () => setBusyPackId(null) },
        };
        const rzp = new window.Razorpay(options);
        rzp.open();
        return;
      }

      // Stub mode — call verify directly (PAYMENT_VERIFY_DISABLED=true in dev,
      // or demo build returning canned responses).
      await postVerify(
        "/api/payments/purchase-credits",
        { packId: pack.id, razorpayOrderId: orderBody.orderId },
        () => {
          toast({
            title: "Credits added",
            description: `${pack.credits} credits granted. ${charityPctText} of every pack supports charity.`,
          });
          refetchUsage();
          setBusyPackId(null);
        },
        (msg) => {
          toast({ title: "Purchase blocked", description: msg, variant: "destructive" });
          setBusyPackId(null);
        },
      );
    } catch (err) {
      toast({
        title: "Network error",
        description: err instanceof Error ? err.message : "Could not reach payment service.",
        variant: "destructive",
      });
      setBusyPackId(null);
    }
  }

  /** Open Razorpay Checkout (or stub-verify in dev) for a contribution. */
  async function donate(opts: { tierId?: string; tierLabel?: string; customAmountInr?: number; busyKey: string }): Promise<void> {
    const { tierId, tierLabel, customAmountInr, busyKey } = opts;
    const setBusy = (v: boolean): void => {
      if (busyKey === "custom") {
        setCustomBusy(v);
      } else {
        setBusyTierId(v ? busyKey : null);
      }
    };
    setBusy(true);
    try {
      const orderResp = await fetch(apiUrl("/api/contributions/create-order"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify(tierId ? { tierId } : { customAmountInr }),
      });
      const orderBody = await readJson<{
        orderId?: string;
        amount?: number;
        currency?: string;
        keyId?: string;
        label?: string;
      }>(orderResp);
      if (!orderResp.ok || !orderBody?.orderId) {
        toast({
          title: "Couldn't start contribution",
          description: pickUserMessage(
            orderBody,
            "We're enhancing the payment system right now — please check back in a minute.",
          ),
          variant: "destructive",
        });
        setBusy(false);
        return;
      }

      const isLiveCheckout = orderBody.keyId !== "rzp_test_mode" && orderBody.keyId !== "rzp_test_demo";
      const labelText = tierLabel ?? orderBody.label ?? "Contribution";
      const amount = orderBody.amount ?? (customAmountInr ?? 0);

      if (isLiveCheckout) {
        try {
          await loadRazorpayScript();
        } catch {
          toast({ title: "Could not load payment gateway", variant: "destructive" });
          setBusy(false);
          return;
        }
        const options = {
          key: orderBody.keyId,
          amount: amount * 100,
          currency: orderBody.currency ?? "INR",
          name: "GlimpseAI",
          description: `${labelText} (incl. ${charityPctText} to charity)`,
          order_id: orderBody.orderId,
          handler: (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
            void postVerify(
              "/api/contributions/donate",
              {
                ...(tierId ? { tierId } : { customAmountInr }),
                razorpayOrderId: resp.razorpay_order_id,
                razorpayPaymentId: resp.razorpay_payment_id,
                razorpaySignature: resp.razorpay_signature,
              },
              () => {
                toast({
                  title: "Thank you for contributing",
                  description: `${charityPctText} of your contribution goes directly to charity.`,
                });
                if (busyKey === "custom") setCustomAmount("");
                setBusy(false);
              },
              (msg) => {
                toast({ title: "Verification failed", description: msg, variant: "destructive" });
                setBusy(false);
              },
            );
          },
          prefill: {
            name: user?.name ?? "",
            email: user?.email ?? "",
          },
          theme: { color: "#ec4899" },
          modal: { ondismiss: () => setBusy(false) },
        };
        const rzp = new window.Razorpay(options);
        rzp.open();
        return;
      }

      await postVerify(
        "/api/contributions/donate",
        { ...(tierId ? { tierId } : { customAmountInr }), razorpayOrderId: orderBody.orderId },
        () => {
          toast({
            title: "Thank you for contributing",
            description: `${charityPctText} of your contribution goes directly to charity.`,
          });
          if (busyKey === "custom") setCustomAmount("");
          setBusy(false);
        },
        (msg) => {
          toast({ title: "Contribution blocked", description: msg, variant: "destructive" });
          setBusy(false);
        },
      );
    } catch (err) {
      toast({
        title: "Network error",
        description: err instanceof Error ? err.message : "Could not reach contribution service.",
        variant: "destructive",
      });
      setBusy(false);
    }
  }

  function donateCustom(): void {
    const parsed = Number.parseInt(customAmount, 10);
    if (!Number.isFinite(parsed) || parsed < CUSTOM_AMOUNT_MIN || parsed > CUSTOM_AMOUNT_MAX) {
      toast({
        title: "Enter a valid amount",
        description: `Custom contributions must be between ${formatInDisplay(CUSTOM_AMOUNT_MIN, "INR")} and ${formatInDisplay(CUSTOM_AMOUNT_MAX, "INR")}.`,
        variant: "destructive",
      });
      return;
    }
    void donate({ customAmountInr: parsed, busyKey: "custom" });
  }

  return (
    <Layout>
      <div className="p-8 max-w-5xl mx-auto w-full space-y-8">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Billing &amp; Contributions</h1>
            <p className="text-zinc-400 mt-1">
              Subscriptions, one-time credit packs, and voluntary contributions — all in one place.
            </p>
          </div>
          <CurrencySelector value={displayCurrency} onChange={pickCurrency} />
        </div>

        {/* Policy notice — refund policy + cancellation handled by support.
            Renders BEFORE any commerce surface so users always see the terms. */}
        <PolicyNotice />

        {/* Charity disclosure */}
        {charity && (
          <Card className="bg-gradient-to-r from-teal-500/10 via-zinc-950 to-fuchsia-500/10 border-teal-500/30">
            <CardContent className="py-4 flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-teal-300 mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-medium text-zinc-100">
                  {charity.percentage}% of every paid plan, credit pack, and contribution funds charity.
                </div>
                <div className="text-xs text-zinc-400 mt-1 max-w-3xl">
                  {charity.description}
                  {charity.reportUrl ? (
                    <>
                      {" "}
                      <a href={charity.reportUrl} target="_blank" rel="noopener noreferrer" className="text-teal-300 hover:underline">
                        View public report
                      </a>
                      .
                    </>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <UsageSummary usage={usage} isLoading={usageLoading} compact />

        {/* Credit packs */}
        <Card className="bg-zinc-950 border-zinc-800">
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Gift className="w-5 h-5 text-fuchsia-400" /> Credit Packs
                </CardTitle>
                <CardDescription className="text-zinc-400">
                  One-time top-ups that stack with your subscription. Run a big batch without changing your plan.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {catalogLoading ? (
              <div className="flex justify-center p-8">
                <Loader2 className="w-6 h-6 text-fuchsia-400 animate-spin" />
              </div>
            ) : packs.length === 0 ? (
              <div className="text-center py-8 text-zinc-500 border border-dashed border-zinc-800 rounded-lg">
                Credit packs are temporarily unavailable.
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {packs.map((pack) => {
                  const busy = busyPackId === pack.id;
                  return (
                    <div
                      key={pack.id}
                      className={`relative rounded-lg border ${pack.popular ? "border-fuchsia-500/60 bg-fuchsia-500/5" : "border-zinc-800 bg-zinc-900/40"} p-4 flex flex-col gap-3`}
                    >
                      {pack.popular && (
                        <Badge variant="outline" className="absolute -top-2 right-3 border-fuchsia-500/50 bg-fuchsia-500/20 text-fuchsia-200">
                          <Sparkles className="w-3 h-3 mr-1" /> Best value
                        </Badge>
                      )}
                      <div>
                        <div className="text-lg font-semibold text-zinc-100">{pack.name}</div>
                        <div className="text-2xl font-bold text-zinc-50 mt-1">
                          {formatInDisplay(pack.priceInr, displayCurrency)}
                          <span className="text-xs text-zinc-500 font-normal ml-2">one-time</span>
                        </div>
                        {displayCurrency !== "INR" && (
                          <div className="text-[10px] text-zinc-500 mt-0.5">
                            Charged as {formatInDisplay(pack.priceInr, "INR")} via Razorpay
                          </div>
                        )}
                        <div className="text-sm text-zinc-300 mt-1">+{pack.credits} credits</div>
                        <p className="text-xs text-zinc-500 mt-2 leading-relaxed">{pack.description}</p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => void purchasePack(pack)}
                        disabled={busy}
                        className={pack.popular ? "bg-fuchsia-500 hover:bg-fuchsia-400 text-white" : ""}
                      >
                        {busy ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Processing
                          </>
                        ) : (
                          <>Buy this pack</>
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Voluntary contributions */}
        <Card className="bg-zinc-950 border-zinc-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Heart className="w-5 h-5 text-pink-400" /> Support GlimpseAI
            </CardTitle>
            <CardDescription className="text-zinc-400">
              Voluntary contribution toward platform development. You get no extra usage — but {charityPctText} of every
              contribution goes directly to charity, and the rest funds infrastructure and accessibility work.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {catalogLoading ? (
              <div className="flex justify-center p-8">
                <Loader2 className="w-6 h-6 text-pink-400 animate-spin" />
              </div>
            ) : tiers.length === 0 ? (
              <div className="text-center py-6 text-zinc-500 border border-dashed border-zinc-800 rounded-lg">
                Contribution tiers are temporarily unavailable.
              </div>
            ) : (
              <div className="grid sm:grid-cols-3 gap-3">
                {tiers.map((tier) => {
                  const busy = busyTierId === tier.id;
                  return (
                    <div
                      key={tier.id}
                      className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-2"
                    >
                      <div className="text-base font-semibold text-zinc-100">{tier.label}</div>
                      <div className="text-xl font-bold text-pink-300">
                        {formatInDisplay(tier.amountInr, displayCurrency)}
                      </div>
                      {displayCurrency !== "INR" && (
                        <div className="text-[10px] text-zinc-500">
                          Charged as {formatInDisplay(tier.amountInr, "INR")} via Razorpay
                        </div>
                      )}
                      <p className="text-xs text-zinc-500 leading-relaxed flex-1">{tier.blurb}</p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-pink-500/50 text-pink-200 hover:bg-pink-500/10"
                        onClick={() => void donate({ tierId: tier.id, tierLabel: tier.label, busyKey: tier.id })}
                        disabled={busy}
                      >
                        {busy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <>Contribute {formatInDisplay(tier.amountInr, displayCurrency)}</>
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="rounded-lg border border-dashed border-zinc-700 p-4 flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
              <div className="flex-1">
                <label htmlFor="custom-contribution" className="text-sm text-zinc-300 block mb-1">
                  Or pick your own amount (charged in INR)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">₹</span>
                  <input
                    id="custom-contribution"
                    type="number"
                    inputMode="numeric"
                    min={CUSTOM_AMOUNT_MIN}
                    max={CUSTOM_AMOUNT_MAX}
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    placeholder={`Between ${CUSTOM_AMOUNT_MIN} and ${CUSTOM_AMOUNT_MAX.toLocaleString()}`}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-900 pl-7 pr-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-pink-500/60"
                  />
                </div>
                {customAmount && Number.isFinite(Number.parseInt(customAmount, 10)) && displayCurrency !== "INR" && (
                  <div className="text-[10px] text-zinc-500 mt-1">
                    {formatWithDisplayHint(Number.parseInt(customAmount, 10), displayCurrency)}
                  </div>
                )}
              </div>
              <Button
                size="sm"
                className="bg-pink-500 hover:bg-pink-400 text-white"
                onClick={donateCustom}
                disabled={customBusy}
              >
                {customBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Heart className="w-3.5 h-3.5 mr-1.5" />}
                Contribute
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Existing payment history */}
        <Card className="bg-zinc-950 border-zinc-800">
          <CardHeader>
            <CardTitle>Payment History</CardTitle>
            <CardDescription className="text-zinc-400">
              All subscriptions, credit packs, and contributions you've made.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {paymentsLoading ? (
              <div className="flex justify-center p-8">
                <div className="w-6 h-6 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
              </div>
            ) : payments && payments.length > 0 ? (
              <div className="rounded-md border border-zinc-800">
                <Table>
                  <TableHeader className="bg-zinc-900/50">
                    <TableRow className="border-zinc-800 hover:bg-transparent">
                      <TableHead className="text-zinc-400">Date</TableHead>
                      <TableHead className="text-zinc-400">Amount</TableHead>
                      <TableHead className="text-zinc-400">Status</TableHead>
                      <TableHead className="text-zinc-400">Type</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((payment) => {
                      const kind =
                        payment.billingPeriod === "donation"
                          ? "Contribution"
                          : payment.billingPeriod === "one-time"
                          ? "Credit pack"
                          : payment.billingPeriod
                          ? `${payment.billingPeriod.charAt(0).toUpperCase()}${payment.billingPeriod.slice(1)} plan`
                          : "—";
                      return (
                        <TableRow key={payment.id} className="border-zinc-800 hover:bg-zinc-900/50">
                          <TableCell className="font-medium">
                            {new Date(payment.createdAt).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="font-mono">
                            {formatInDisplay(payment.amount, displayCurrency)}
                            {displayCurrency !== "INR" && (
                              <span className="text-[10px] text-zinc-500 ml-2">
                                ({formatInDisplay(payment.amount, "INR")})
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                payment.status === "success"
                                  ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10"
                                  : payment.status === "failed"
                                  ? "border-red-500/50 text-red-400 bg-red-500/10"
                                  : "border-zinc-500/50 text-zinc-400 bg-zinc-500/10"
                              }
                            >
                              {payment.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-zinc-300">{kind}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-12 text-zinc-500 border border-dashed border-zinc-800 rounded-lg">
                No payments or contributions yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
