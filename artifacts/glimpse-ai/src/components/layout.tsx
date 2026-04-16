import React from "react";
import { Link } from "wouter";
import { useAuth } from "../lib/auth-context";
import { useGetUserUsage, useListMediaJobs } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Sparkles, LogOut, LayoutDashboard, Wand2, Clock, Settings, CreditCard, Shield } from "lucide-react";

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-black text-white flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-white/10 bg-zinc-950 flex flex-col hidden md:flex">
        <div className="p-6">
          <Link href="/dashboard" className="flex items-center gap-2 font-bold text-xl tracking-tighter">
            <Sparkles className="w-5 h-5 text-purple-500" />
            GlimpseAI
          </Link>
        </div>
        <div className="px-4 py-2 flex-1">
          <div className="space-y-1">
            <Link href="/dashboard" className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/5 text-white">
              <LayoutDashboard className="w-4 h-4" />
              Dashboard
            </Link>
            <Link href="/editor" className="flex items-center gap-3 px-3 py-2 rounded-lg text-white/70 hover:bg-white/5 hover:text-white transition-colors">
              <Wand2 className="w-4 h-4" />
              Editor
            </Link>
            <Link href="/history" className="flex items-center gap-3 px-3 py-2 rounded-lg text-white/70 hover:bg-white/5 hover:text-white transition-colors">
              <Clock className="w-4 h-4" />
              History
            </Link>
          </div>
          
          <div className="mt-8">
            <div className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2 px-3">Account</div>
            <div className="space-y-1">
              <Link href="/billing" className="flex items-center gap-3 px-3 py-2 rounded-lg text-white/70 hover:bg-white/5 hover:text-white transition-colors">
                <CreditCard className="w-4 h-4" />
                Billing
              </Link>
              <Link href="/settings" className="flex items-center gap-3 px-3 py-2 rounded-lg text-white/70 hover:bg-white/5 hover:text-white transition-colors">
                <Settings className="w-4 h-4" />
                Settings
              </Link>
              {user?.role === "admin" && (
                <Link href="/admin" className="flex items-center gap-3 px-3 py-2 rounded-lg text-purple-400 hover:bg-white/5 transition-colors">
                  <Shield className="w-4 h-4" />
                  Admin
                </Link>
              )}
            </div>
          </div>
        </div>
        
        <div className="p-4 border-t border-white/10">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium truncate">{user?.name}</div>
            <button onClick={logout} className="text-white/50 hover:text-white">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
