import React, { useState } from "react";
import Layout from "../components/layout";
import { useListPlans, useCreatePaymentOrder } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, Sparkles } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export default function Pricing() {
  const [isAnnual, setIsAnnual] = useState(true);
  const { data: plans, isLoading } = useListPlans();
  const createOrder = useCreatePaymentOrder();
  const { toast } = useToast();

  const handleSubscribe = (planId: number) => {
    createOrder.mutate(
      { data: { planId, billingPeriod: isAnnual ? "annual" : "monthly" } },
      {
        onSuccess: () => {
          toast({ title: "Order created", description: "Payment integration would open here." });
        },
        onError: (err: any) => {
          toast({ title: "Error", description: err.error || "Failed to initiate payment", variant: "destructive" });
        }
      }
    );
  };

  return (
    <Layout>
      <div className="p-8 max-w-6xl mx-auto w-full">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold tracking-tight mb-4">Pricing that scales with you</h1>
          <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
            Choose the perfect plan for your creative journey. All plans include access to our core AI engine.
          </p>
          
          <div className="flex items-center justify-center gap-4 mt-8">
            <Label htmlFor="billing-toggle" className={`text-sm font-medium ${!isAnnual ? 'text-white' : 'text-zinc-500'}`}>Monthly</Label>
            <Switch 
              id="billing-toggle" 
              checked={isAnnual} 
              onCheckedChange={setIsAnnual} 
              className="data-[state=checked]:bg-purple-600"
            />
            <Label htmlFor="billing-toggle" className={`text-sm font-medium flex items-center gap-2 ${isAnnual ? 'text-white' : 'text-zinc-500'}`}>
              Annually <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 text-xs">Save 20%</span>
            </Label>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center"><div className="w-8 h-8 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" /></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {plans?.map((plan) => (
              <Card 
                key={plan.id} 
                className={`relative bg-zinc-950 border-zinc-800 flex flex-col ${plan.isPopular ? 'border-purple-500 shadow-2xl shadow-purple-500/10 scale-105 z-10' : ''}`}
              >
                {plan.isPopular && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-purple-600 text-white px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Most Popular
                  </div>
                )}
                <CardHeader>
                  <CardTitle className="text-xl">{plan.name}</CardTitle>
                  <CardDescription className="text-zinc-400">{plan.description}</CardDescription>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-4xl font-bold">${isAnnual ? plan.priceAnnual / 12 : plan.priceMonthly}</span>
                    <span className="text-zinc-500">/mo</span>
                  </div>
                  {isAnnual && plan.priceAnnual > 0 && (
                    <div className="text-sm text-zinc-500 mt-1">Billed ${plan.priceAnnual} yearly</div>
                  )}
                </CardHeader>
                <CardContent className="flex-1">
                  <ul className="space-y-3">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-3 text-sm text-zinc-300">
                        <Check className="w-4 h-4 text-purple-500 shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  <Button 
                    className={`w-full ${plan.isPopular ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-white text-black hover:bg-white/90'}`}
                    onClick={() => handleSubscribe(plan.id)}
                    disabled={createOrder.isPending}
                  >
                    {plan.priceMonthly === 0 ? 'Current Plan' : 'Subscribe'}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
