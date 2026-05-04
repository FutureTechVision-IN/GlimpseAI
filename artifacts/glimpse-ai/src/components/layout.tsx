import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "../lib/auth-context";
import { Button } from "@/components/ui/button";
import {
  Sparkles, LogOut, LayoutDashboard, Clock, Settings,
  CreditCard, Shield, ImageIcon, Video, Menu, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FeedbackWidget } from "./feedback-widget";
import { AdminErrorToaster } from "./admin/admin-error-toaster";

function NavLink({
  href,
  icon: Icon,
  label,
  exact = false,
  onClick,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  exact?: boolean;
  onClick?: () => void;
}) {
  const [location] = useLocation();
  const isActive = exact ? location === href : location.startsWith(href);
  return (
    <Link
      href={href}
      onClick={onClick}
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

function SidebarContent({ onNavClick }: { onNavClick?: () => void }) {
  const { user, logout } = useAuth();
  return (
    <>
      {/* Sidebar header: brand only. The theme toggle deliberately lives
          on Settings (single source of truth) — placing it here as well
          created two competing controls that could disagree until the
          broadcast event landed, and the user explicitly asked for one. */}
      <div className="p-6">
        <Link
          href="/dashboard"
          onClick={onNavClick}
          className="flex items-center gap-2 font-bold text-xl tracking-tighter group"
        >
          <Sparkles className="w-5 h-5 text-teal-500 group-hover:text-teal-400 transition-colors" />
          <span className="bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
            GlimpseAI
          </span>
        </Link>
      </div>

      <div className="px-3 py-3 flex-1 overflow-y-auto">
        <div className="space-y-0.5">
          <NavLink href="/dashboard"    icon={LayoutDashboard} label="Dashboard"     exact onClick={onNavClick} />
          <NavLink href="/photo-studio" icon={ImageIcon}       label="Photo Studio"        onClick={onNavClick} />
          <NavLink href="/video-studio" icon={Video}           label="Video Studio"        onClick={onNavClick} />
          <NavLink href="/history"      icon={Clock}           label="History"             onClick={onNavClick} />
        </div>

        <div className="mt-6">
          <div className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-2 px-3">
            Account
          </div>
          <div className="space-y-0.5">
            <NavLink href="/billing"  icon={CreditCard} label="Billing"     onClick={onNavClick} />
            <NavLink href="/settings" icon={Settings}   label="Settings"    onClick={onNavClick} />
            {user?.role === "admin" && (
              <NavLink href="/admin" icon={Shield} label="Admin Panel" onClick={onNavClick} />
            )}
          </div>
        </div>
      </div>

      {/* Bottom: user info + logout. Extra bottom padding clears the
          floating FeedbackWidget pill (fixed bottom-4 left-4) on every
          viewport so the row never gets visually overlapped. */}
      <div className="p-4 pb-16 border-t border-white/10">
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
    </>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-screen bg-black text-white flex">
      {/* ── Desktop sidebar (md+) ─────────────────────────────────── */}
      <aside className="w-64 border-r border-white/10 bg-zinc-950 flex-col hidden md:flex shrink-0">
        <SidebarContent />
      </aside>

      {/* ── Mobile drawer overlay ─────────────────────────────────── */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Mobile sliding drawer ─────────────────────────────────── */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 bg-zinc-950 border-r border-white/10 flex flex-col",
          "transition-transform duration-300 ease-in-out md:hidden",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Navigation menu"
      >
        <button
          onClick={() => setDrawerOpen(false)}
          className="absolute top-4 right-4 text-white/40 hover:text-white p-1 rounded hover:bg-white/10 transition-colors"
          aria-label="Close menu"
        >
          <X className="w-5 h-5" />
        </button>
        <SidebarContent onNavClick={() => setDrawerOpen(false)} />
      </aside>

      {/* ── Main content ─────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar with hamburger + brand only. Theme toggle is on
            the Settings page (single source of truth). */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-white/10 bg-zinc-950 md:hidden">
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-white/60 hover:text-white p-1.5 rounded hover:bg-white/10 transition-colors"
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <Link href="/dashboard" className="flex items-center gap-2 font-bold text-base tracking-tighter">
            <Sparkles className="w-4 h-4 text-teal-500" />
            <span className="bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
              GlimpseAI
            </span>
          </Link>
        </header>

        <div className="flex-1 overflow-y-auto">
          {children}
        </div>

        {/* Footer */}
        <footer className="border-t border-white/10 bg-zinc-950 px-6 py-4">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
            <span className="text-xs text-zinc-600">
              &copy; {new Date().getFullYear()} GlimpseAI. All rights reserved.
            </span>
            <nav className="flex items-center gap-5 text-xs text-zinc-500">
              <Link href="/pricing" className="hover:text-teal-400 transition-colors">Pricing</Link>
              <Link href="/terms"   className="hover:text-teal-400 transition-colors">Terms</Link>
              <Link href="/privacy" className="hover:text-teal-400 transition-colors">Privacy</Link>
              <Link href="/contact" className="hover:text-teal-400 transition-colors">Contact</Link>
            </nav>
          </div>
        </footer>
      </main>

      {/* Global feedback launcher — fixed bottom-left so it never collides
          with the AI chat widget (bottom-right) or completion-screen promos
          on the editor (bottom-center). */}
      <FeedbackWidget />

      {/* Admin-only background poller for new error events.
          Renders nothing visible — only fires toast notifications when an
          admin is signed in and a new error has appeared since last poll. */}
      <AdminErrorToaster />
    </div>
  );
}
