import React, { useState } from "react";
import Layout from "../components/layout";
import { useAuth } from "../lib/auth-context";
import { useUpdateProfile } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { LifeBuoy, Mail, Info, Palette } from "lucide-react";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support";
import { ThemeToggle } from "@/components/theme-toggle";

export default function Settings(): React.ReactElement {
  const { user } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const { toast } = useToast();

  const updateProfile = useUpdateProfile();

  const handleUpdateProfile = (e: React.FormEvent): void => {
    e.preventDefault();
    updateProfile.mutate(
      { data: { name, email } },
      {
        onSuccess: () => {
          toast({ title: "Profile updated successfully" });
        },
        onError: (err: any) => {
          toast({ title: "Update failed", description: err.error || "An error occurred", variant: "destructive" });
        }
      }
    );
  };

  return (
    <Layout>
      <div className="p-8 max-w-4xl mx-auto w-full space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-zinc-400 mt-1">Manage your account preferences and profile.</p>
        </div>

        <Card className="bg-zinc-950 border-zinc-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="w-5 h-5 text-teal-300" /> Appearance
            </CardTitle>
            <CardDescription className="text-zinc-400">
              Switch between light and dark — your choice is remembered on this device.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ThemeToggle />
            <p className="mt-2 text-xs text-zinc-500">
              "System" follows your operating-system preference and updates live.
            </p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-950 border-zinc-800">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription className="text-zinc-400">Update your personal information.</CardDescription>
          </CardHeader>
          <form onSubmit={handleUpdateProfile}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-black border-zinc-800 focus-visible:ring-teal-500 max-w-md"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-black border-zinc-800 focus-visible:ring-teal-500 max-w-md"
                />
              </div>
            </CardContent>
            <CardFooter className="border-t border-zinc-800 pt-6">
              <Button type="submit" disabled={updateProfile.isPending} className="bg-white text-black hover:bg-zinc-200">
                {updateProfile.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </CardFooter>
          </form>
        </Card>

        {/* Account closure & cancellation — handled exclusively via support to
            prevent accidental loss and to allow human review of refund-policy
            disputes (we operate a strict no-refund policy on used services). */}
        <Card className="bg-zinc-950 border-zinc-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LifeBuoy className="w-5 h-5 text-teal-300" /> Account closure &amp; subscription cancellation
            </CardTitle>
            <CardDescription className="text-zinc-400">
              For your safety, account deletion and subscription cancellation are processed only through our support team.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3 rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
              <Info className="w-4 h-4 text-zinc-400 mt-0.5 shrink-0" />
              <div className="text-sm text-zinc-300 space-y-1">
                <p>
                  We do <span className="text-zinc-100 font-medium">not</span> offer self-service account deletion or
                  cancellation. Email support and we'll verify your identity, action your request, and confirm in writing.
                </p>
                <p className="text-xs text-zinc-500">
                  Note: GlimpseAI operates a <span className="text-zinc-300 font-medium">no-refund policy</span> for any
                  service that has already been used or any one-time credit pack that has been redeemed.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild className="bg-teal-600 hover:bg-teal-700 text-white">
                <a href={supportMailto("Account closure request", `Hello,\n\nPlease close my GlimpseAI account associated with ${email || "this email"}.\n\nThank you.`)}>
                  <Mail className="w-4 h-4 mr-2" /> Email support to close account
                </a>
              </Button>
              <Button asChild variant="outline" className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
                <a href={supportMailto("Subscription cancellation", `Hello,\n\nPlease cancel my GlimpseAI subscription on ${email || "this email"}.\n\nThank you.`)}>
                  Cancel subscription
                </a>
              </Button>
            </div>
            <p className="text-xs text-zinc-500">
              Support: <a href={`mailto:${SUPPORT_EMAIL}`} className="text-teal-400 hover:underline">{SUPPORT_EMAIL}</a>
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
