import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { useRegister, useLogin } from "@workspace/api-client-react";
import { useAuth } from "../lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const registerMutation = useRegister();
  const loginMutation = useLogin();
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    registerMutation.mutate(
      { data: { name, email, password } },
      {
        onSuccess: () => {
          // Auto login after register
          loginMutation.mutate(
            { data: { email, password } },
            {
              onSuccess: (data) => {
                login(data.token, data.user);
                setLocation("/dashboard");
              }
            }
          );
        },
        onError: (err: any) => {
          toast({
            title: "Registration failed",
            description: err.error || "An error occurred",
            variant: "destructive"
          });
        }
      }
    );
  };

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
      <Link href="/" className="flex items-center gap-2 font-bold text-2xl tracking-tighter text-white mb-8">
        <Sparkles className="w-6 h-6 text-purple-500" />
        GlimpseAI
      </Link>
      
      <div className="w-full max-w-md bg-zinc-950 border border-white/10 rounded-2xl p-8 shadow-xl">
        <h1 className="text-2xl font-semibold text-white mb-2">Create an account</h1>
        <p className="text-white/60 mb-6">Get 5 free uses when you sign up today.</p>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80">Name</label>
            <Input 
              type="text" 
              value={name} 
              onChange={(e) => setName(e.target.value)}
              className="bg-black border-white/10 text-white focus-visible:ring-purple-500"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80">Email</label>
            <Input 
              type="email" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)}
              className="bg-black border-white/10 text-white focus-visible:ring-purple-500"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80">Password</label>
            <Input 
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)}
              className="bg-black border-white/10 text-white focus-visible:ring-purple-500"
              required
            />
          </div>
          
          <Button 
            type="submit" 
            className="w-full bg-purple-600 hover:bg-purple-700 text-white"
            disabled={registerMutation.isPending || loginMutation.isPending}
          >
            {(registerMutation.isPending || loginMutation.isPending) ? "Creating account..." : "Sign up"}
          </Button>
        </form>
        
        <div className="mt-6 text-center text-sm text-white/60">
          Already have an account? <Link href="/login" className="text-white hover:underline">Log in</Link>
        </div>
      </div>
    </div>
  );
}
