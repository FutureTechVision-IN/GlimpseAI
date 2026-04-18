import React from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "../lib/auth-context";
import { Button } from "@/components/ui/button";
import { Sparkles, LogOut, LayoutDashboard, Wand2, Clock, Settings, CreditCard, Shield, ImageIcon, Video } from "lucide-react";
import { cn } from "@/lib/utils";

function NavLink({ href, icon: Icon, label, exact = false }: {
  href: string;
  icon: React.ElementType;
  label: string;
  exact?: boolean;
}) {
  const [location] = useLocation();
  const isActive = exact ? location === href : location.startsWith(href);
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all",
        isActive
          ? "bg-teal-500/10 text-teal-400 border border-teal-500/20"
          : "text-white/60 hover:bg-white/5 hover:text-white border border-transparent",
      )}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {label}
    </Link>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-black text-white flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-white/10 bg-zinc-950 flex flex-col hidden md:flex shrink-0">
        <div className="p-6">
          <Link href="/dashboard" className="flex items-center gap-2 font-bold text-xl tracking-tighter group">
            <Sparkles className="w-5 h-5 text-teal-500 group-hover:text-teal-400 transition-colors" />
            <span className="bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">GlimpseAI</span>
          </Link>
        </div>

        <div className="px-3 py-2 flex-1 overflow-y-auto">
          <div className="space-y-0.5">
            <NavLink href="/dashboard" icon={LayoutDashboard} label="Dashboard" exact />
            <NavLink href="/photo-studio" icon={ImageIcon}    label="Photo Studio" />
            <NavLink href="/video-studio" icon={Video}        label="Video Studio" />
            <NavLink href="/history"   icon={Clock}           label="History" />
          </div>

          <div className="mt-6">
            <div className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-2 px-3">Account</div>
            <div className="space-y-0.5">
              <NavLink href="/billing"  icon={CreditCard} label="Billing" />
              <NavLink href="/settings" icon={Settings}   label="Settings" />
              {user?.role === "admin" && (
                <NavLink href="/admin" icon={Shield} label="Admin Panel" />
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-white/10">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{user?.name}</div>
              <div className="text-xs text-white/40 truncate">{user?.email ?? user?.role}</div>
            </div>
            <button
              onClick={logout}
              className="text-white/40 hover:text-white transition-colors shrink-0 p-1 rounded hover:bg-white/10"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>

        {/* Footer */}
        <footer className="border-t border-white/10 bg-zinc-950 px-6 py-4">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
            <span className="text-xs text-zinc-600">&copy; {new Date().getFullYear()} GlimpseAI. All rights reserved.</span>
            <nav className="flex items-center gap-5 text-xs text-zinc-500">
              <Link href="/pricing" className="hover:text-teal-400 transition-colors">Pricing</Link>
              <Link href="/terms" className="hover:text-teal-400 transition-colors">Terms</Link>
              <Link href="/privacy" className="hover:text-teal-400 transition-colors">Privacy</Link>
              <Link href="/contact" className="hover:text-teal-400 transition-colors">Contact</Link>
            </nav>
          </div>
        </footer>
      </main>
    </div>
  );
}
