import React from "react";
import { useAuth } from "../lib/auth-context";
import { Redirect } from "wouter";

export function ProtectedRoute({ children, requireAdmin }: { children: React.ReactNode, requireAdmin?: boolean }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-white">Loading...</div>;
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  if (requireAdmin && user.role !== "admin") {
    return <Redirect to="/dashboard" />;
  }

  return <>{children}</>;
}
