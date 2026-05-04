import React, { useState, useCallback } from "react";
import Layout from "../components/layout";
import { useListPlans, useCreatePaymentOrder, useVerifyPayment } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, Sparkles, Shield, Zap, Crown, LifeBuoy } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import {
  type CurrencyCode,
  formatInDisplay,
  readPreferredCurrency,
  writePreferredCurrency,
} from "@/lib/currency";
import { CurrencySelector } from "@/components/currency-selector";
import { PolicyNotice } from "@/components/policy-notice";

declare global {
  interface Window {
    Razorpay: any;
  }
}

const planIcons: Record<string, React.ReactNode> = {
  free: <Shield className="w-5 h-5 text-zinc-400" />,
  basic: <Zap className="w-5 h-5 text-blue-400" />,
  premium: <Crown className="w-5 h-5 text-amber-400" />,
};

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) { resolve(); return; }
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Razorpay"));
    document.head.appendChild(s);
  });
}

export default function Pricing() {
  const [isAnnual, setIsAnnual] = useState(true);
  const [processingPlanId, setProcessingPlanId] = useState<number | null>(null);
  const [displayCurrency, setDisplayCurrency] = useState<CurrencyCode>(readPreferredCurrency());
  const { data: plans, isLoading } = useListPlans();
  const createOrder = useCreatePaymentOrder();
  const verifyPayment = useVerifyPayment();
  const { toast } = useToast();
  const { user } = useAuth();

  function pickCurrency(code: CurrencyCode): void {
    setDisplayCurrency(code);
    writePreferredCurrency(code);
  }

  const handleSubscribe = useCallback(async (planId: number) => {
    setProcessingPlanId(planId);
    try {
      await loadRazorpayScript();
    } catch {
      toast({ title: "Error", description: "Could not load payment gateway. Please try again.", variant: "destructive" });
      setProcessingPlanId(null);
      return;
    }

    createOrder.mutate(
      { data: { planId, billingPeriod: isAnnual ? "annual" : "monthly" } },
      {
        onSuccess: (data: any) => {
          const options = {
            key: data.keyId,
            amount: data.amount * 100,
            currency: data.currency,
            name: "GlimpseAI",
            description: `${isAnnual ? "Annual" : "Monthly"} Subscription`,
            order_id: data.orderId,
            handler: (response: any) => {
              verifyPayment.mutate(
                {
                  data: {
                    razorpayOrderId: response.razorpay_order_id,
                    razorpayPaymentId: response.razorpay_payment_id,
                    razorpaySignature: response.razorpay_signature,
                    planId,
                    billingPeriod: isAnnual ? "annual" : "monthly",
                  },
                },
                {
                  onSuccess: () => {
                    toast({ title: "Welcome aboard!", description: "Your subscription is now active." });
                    setProcessingPlanId(null);
                  },
                  onError: () => {
                    toast({ title: "Verification failed", description: "Contact support if you were charged.", variant: "destructive" });
                    setProcessingPlanId(null);
                  },
                }
              );
            },
            prefill: {
              name: user?.name ?? "",
              email: user?.email ?? "",
            },
            theme: { color: "#0d9488" },
            modal: {
              ondismiss: () => setProcessingPlanId(null),
            },
          };

          const rzp = new window.Razorpay(options);
          rzp.open();
        },
        onError: (err: any) => {
          toast({ title: "Error", description: err.error || "Failed to initiate payment", variant: "destructive" });
          setProcessingPlanId(null);
        },
      }
    );
  }, [isAnnual, createOrder, verifyPayment, toast, user]);

  return (
    <Layout>
      <div className="p-8 max-w-6xl mx-auto w-full">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold tracking-tight mb-4">Pricing that scales with you</h1>
          <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
            Start free with 5 enhancements. Upgrade anytime for 20/day — photos and videos combined.
          </p>

          <div className="flex items-center justify-center gap-4 mt-8 flex-wrap">
            <Label htmlFor="billing-toggle" className={`text-sm font-medium ${!isAnnual ? "text-white" : "text-zinc-500"}`}>Monthly</Label>
            <Switch
              id="billing-toggle"
              checked={isAnnual}
              onCheckedChange={setIsAnnual}
              className="data-[state=checked]:bg-teal-600"
            />
            <Label htmlFor="billing-toggle" className={`text-sm font-medium flex items-center gap-2 ${isAnnual ? "text-white" : "text-zinc-500"}`}>
              Annually <span className="px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-400 text-xs">Save ~17%</span>
            </Label>
            <span className="text-zinc-700">·</span>
            <CurrencySelector value={displayCurrency} onChange={pickCurrency} />
          </div>
        </div>

        <div className="mb-8">
          <PolicyNotice />
        </div>

        {isLoading ? (
          <div className="flex justify-center"><div className="w-8 h-8 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" /></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {plans?.map((plan) => {
              const monthlyPrice = isAnnual
                ? Math.round(plan.priceAnnual / 12)
                : plan.priceMonthly;
              const isFree = plan.priceMonthly === 0;
              const isCurrentPlan = user?.planId === plan.id || (isFree && !user?.planId);

              return (
                <Card
                  key={plan.id}
                  className={`relative bg-zinc-950 border-zinc-800 flex flex-col ${plan.isPopular ? "border-teal-500 shadow-2xl shadow-teal-500/10 scale-105 z-10" : ""}`}
                >
                  {plan.isPopular && (
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-teal-600 text-white px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider flex items-center gap-1">
                      <Sparkles className="w-3 h-3" /> Most Popular
                    </div>
                  )}
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      {planIcons[plan.slug] ?? null}
                      <CardTitle className="text-xl">{plan.name}</CardTitle>
                    </div>
                    <CardDescription className="text-zinc-400">{plan.description}</CardDescription>
                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="text-4xl font-bold">{formatInDisplay(monthlyPrice, displayCurrency)}</span>
                      {!isFree && <span className="text-zinc-500">/mo</span>}
                    </div>
                    {!isFree && (
                      <div className="text-sm text-zinc-500 mt-1 space-y-0.5">
                        {displayCurrency !== "INR" && (
                          <div>Charged as {formatInDisplay(monthlyPrice, "INR")}/mo via Razorpay</div>
                        )}
                        {isAnnual && (
                          <div>
                            Billed {formatInDisplay(plan.priceAnnual, displayCurrency)} yearly
                            {displayCurrency !== "INR" && (
                              <span className="text-zinc-600"> ({formatInDisplay(plan.priceAnnual, "INR")})</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {isFree && <div className="text-sm text-zinc-500 mt-1">No credit card required</div>}
                  </CardHeader>
                  <CardContent className="flex-1">
                    <ul className="space-y-3">
                      {plan.features.map((feature, i) => (
                        <li key={i} className="flex items-start gap-3 text-sm text-zinc-300">
                          <Check className="w-4 h-4 text-teal-500 shrink-0 mt-0.5" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                  <CardFooter>
                    {isCurrentPlan ? (
                      <Button className="w-full bg-zinc-800 text-zinc-400 cursor-default" disabled>
                        Current Plan
                      </Button>
                    ) : isFree ? (
                      <Button className="w-full bg-zinc-800 text-zinc-300 hover:bg-zinc-700" disabled>
                        Free Forever
                      </Button>
                    ) : (
                      <Button
                        className={`w-full ${plan.isPopular ? "bg-teal-600 hover:bg-teal-700 text-white" : "bg-white text-black hover:bg-white/90"}`}
                        onClick={() => handleSubscribe(plan.id)}
                        disabled={processingPlanId !== null}
                      >
                        {processingPlanId === plan.id ? (
                          <span className="flex items-center gap-2">
                            <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                            Processing…
                          </span>
                        ) : (
                          "Subscribe"
                        )}
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}

        {/* Trust badges — copy aligned with the no-refund + cancel-via-support
            policy. Avoid implying instant self-service cancellation. */}
        <div className="flex flex-wrap items-center justify-center gap-6 mt-16 text-sm text-zinc-500">
          <div className="flex items-center gap-2"><Shield className="w-4 h-4" /> Secure payments via Razorpay</div>
          <div className="flex items-center gap-2"><LifeBuoy className="w-4 h-4" /> Cancellations via support</div>
          <div className="flex items-center gap-2"><Check className="w-4 h-4" /> Multi-currency display (INR settlement)</div>
        </div>
      </div>
    </Layout>
  );
}
