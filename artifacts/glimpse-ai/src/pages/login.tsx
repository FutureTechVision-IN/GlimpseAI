import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { useLogin } from "@workspace/api-client-react";
import { useAuth } from "../lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const loginMutation = useLogin();
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate(
      { data: { email, password } },
      {
        onSuccess: (data) => {
          login(data.token, data.user);
          setLocation("/dashboard");
        },
        onError: () => {
          toast({
            title: "Login failed",
            description: "Invalid credentials",
            variant: "destructive"
          });
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
      
      <div className="w-full max-w-md bg-zinc-950 border border-white/10 rounded-2xl p-8 shadow-xl">
        <h1 className="text-2xl font-semibold text-white mb-2">Welcome back</h1>
        <p className="text-white/60 mb-6">Log in to your account to continue editing.</p>

        {import.meta.env.VITE_DEMO_MODE === "true" && (
          <div className="mb-4 p-3 rounded-lg bg-teal-500/10 border border-teal-500/20 text-xs text-teal-300 flex items-start gap-2">
            <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span><strong>Demo mode</strong> — enter any email &amp; password to explore the full dashboard.</span>
          </div>
        )}

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
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80">Password</label>
            <Input 
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)}
              className="bg-black border-white/10 text-white focus-visible:ring-teal-500"
              required
            />
          </div>
          
          <Button 
            type="submit" 
            className="w-full bg-white text-black hover:bg-white/90"
            disabled={loginMutation.isPending}
          >
            {loginMutation.isPending ? "Logging in..." : "Log in"}
          </Button>
        </form>
        
        <div className="mt-6 text-center text-sm text-white/60">
          Don't have an account? <Link href="/register" className="text-white hover:underline">Sign up</Link>
        </div>
      </div>
    </div>
  );
}
