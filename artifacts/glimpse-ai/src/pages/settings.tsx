import React, { useState } from "react";
import Layout from "../components/layout";
import { useAuth } from "../lib/auth-context";
import { useUpdateProfile, useDeleteAccount } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";

export default function Settings() {
  const { user, logout } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const { toast } = useToast();
  
  const updateProfile = useUpdateProfile();
  const deleteAccount = useDeleteAccount();

  const handleUpdateProfile = (e: React.FormEvent) => {
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

  const handleDeleteAccount = () => {
    deleteAccount.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Account deleted" });
        logout();
      },
      onError: (err: any) => {
        toast({ title: "Deletion failed", description: err.error || "An error occurred", variant: "destructive" });
      }
    });
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

        <Card className="bg-zinc-950 border-red-900/50">
          <CardHeader>
            <CardTitle className="text-red-500">Danger Zone</CardTitle>
            <CardDescription className="text-zinc-400">Permanently delete your account and all associated data.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-zinc-300 mb-4">
              Once you delete your account, there is no going back. Please be certain.
            </div>
            
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Delete Account</Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-zinc-950 border-zinc-800 text-white">
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription className="text-zinc-400">
                    This action cannot be undone. This will permanently delete your account
                    and remove your data from our servers.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-white">Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeleteAccount} className="bg-red-600 hover:bg-red-700 text-white">
                    {deleteAccount.isPending ? "Deleting..." : "Yes, delete account"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
