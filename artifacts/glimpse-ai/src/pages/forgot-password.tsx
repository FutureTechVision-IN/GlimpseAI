import React, { useState } from "react";
import { Link } from "wouter";
import { useForgotPassword } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const forgotPassword = useForgotPassword();
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    forgotPassword.mutate(
      { data: { email } },
      {
        onSuccess: () => {
          toast({ title: "Reset link sent", description: "Check your email for password reset instructions." });
          setEmail("");
        },
        onError: (err: any) => {
          toast({ title: "Failed", description: err.error || "An error occurred", variant: "destructive" });
        }
      }
    );
  };

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
      <Link href="/" className="flex items-center gap-2 font-bold text-2xl tracking-tighter text-white mb-8">
        <Sparkles className="w-6 h-6 text-teal-500" />
        GlimpseAI
      </Link>
      
      <div className="w-full max-w-md bg-zinc-950 border border-white/10 rounded-2xl p-8 shadow-xl relative">
        <Link href="/login" className="absolute top-8 left-8 text-zinc-500 hover:text-white">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-semibold text-white mb-2 mt-8 text-center">Reset Password</h1>
        <p className="text-white/60 mb-6 text-center text-sm">Enter your email address and we'll send you a link to reset your password.</p>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80">Email</label>
            <Input 
              type="email" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)}
              className="bg-black border-white/10 text-white focus-visible:ring-teal-500"
              required
            />
          </div>
          
          <Button 
            type="submit" 
            className="w-full bg-white text-black hover:bg-white/90"
            disabled={forgotPassword.isPending}
          >
            {forgotPassword.isPending ? "Sending..." : "Send Reset Link"}
          </Button>
        </form>
      </div>
    </div>
  );
}
