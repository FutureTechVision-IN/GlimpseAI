import React from "react";
import { useAuth } from "../lib/auth-context";
import { useGetUserUsage, useListMediaJobs } from "@workspace/api-client-react";
import { Link } from "wouter";
import Layout from "../components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wand2, Image as ImageIcon, Video, Clock, ArrowRight, Zap, CheckCircle2, XCircle, Loader2, Shield } from "lucide-react";
import { Progress } from "@/components/ui/progress";

export default function Dashboard() {
  const { user } = useAuth();
  const { data: usage, isLoading: isLoadingUsage } = useGetUserUsage();
  const { data: recentJobs, isLoading: isLoadingJobs } = useListMediaJobs({ status: "all" });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed": return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case "failed": return <XCircle className="w-4 h-4 text-red-500" />;
      case "processing": return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      default: return <Clock className="w-4 h-4 text-zinc-500" />;
    }
  };

  return (
    <Layout>
      <div className="p-8 max-w-6xl mx-auto w-full space-y-8">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Welcome back, {user?.role === "admin" ? "Admin" : user?.name?.split(' ')[0]}</h1>
            <p className="text-zinc-400 mt-1">Here's an overview of your creative workspace.</p>
          </div>
          <div className="flex items-center gap-3">
            {user?.role === "admin" && (
              <Link href="/admin">
                <Button variant="outline" className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
                  <Shield className="w-4 h-4 mr-2" />
                  Admin Panel
                </Button>
              </Link>
            )}
            <Link href="/editor">
              <Button className="bg-teal-600 hover:bg-teal-700 text-white shadow-lg shadow-teal-500/20">
                <Wand2 className="w-4 h-4 mr-2" />
                New Enhancement
              </Button>
            </Link>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-zinc-950 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-400 flex items-center justify-between">
                Credits Used
                <Zap className="w-4 h-4 text-teal-500" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingUsage ? (
                <div className="h-10 bg-zinc-900 animate-pulse rounded-md" />
              ) : (
                <>
                  <div className="text-3xl font-bold mb-2">
                    {usage?.creditsUsed} <span className="text-sm text-zinc-500 font-normal">/ {usage?.creditsLimit}</span>
                  </div>
                  <Progress value={((usage?.creditsUsed || 0) / (usage?.creditsLimit || 1)) * 100} className="h-2 bg-zinc-900" />
                </>
              )}
            </CardContent>
          </Card>
          
          <Card className="bg-zinc-950 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-400 flex items-center justify-between">
                Photos Enhanced
                <ImageIcon className="w-4 h-4 text-blue-500" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingUsage ? (
                <div className="h-10 bg-zinc-900 animate-pulse rounded-md" />
              ) : (
                <div className="text-3xl font-bold">{usage?.photoCount || 0}</div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-zinc-950 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-400 flex items-center justify-between">
                Videos Enhanced
                <Video className="w-4 h-4 text-emerald-500" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingUsage ? (
                <div className="h-10 bg-zinc-900 animate-pulse rounded-md" />
              ) : (
                <div className="text-3xl font-bold">{usage?.videoCount || 0}</div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Recent Jobs</h2>
            <Link href="/history" className="text-sm text-teal-400 hover:text-teal-300 flex items-center">
              View all <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
          </div>
          
          <Card className="bg-zinc-950 border-zinc-800">
            <div className="divide-y divide-zinc-800">
              {isLoadingJobs ? (
                Array(3).fill(0).map((_, i) => (
                  <div key={i} className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-zinc-900 rounded animate-pulse" />
                      <div className="space-y-2">
                        <div className="h-4 w-32 bg-zinc-900 animate-pulse rounded" />
                        <div className="h-3 w-20 bg-zinc-900 animate-pulse rounded" />
                      </div>
                    </div>
                  </div>
                ))
              ) : recentJobs?.length === 0 ? (
                <div className="p-8 text-center text-zinc-500">
                  <Wand2 className="w-8 h-8 mx-auto mb-3 opacity-20" />
                  <p>No recent enhancements.</p>
                  <Link href="/editor">
                    <Button variant="link" className="text-teal-400 mt-2">Start your first edit</Button>
                  </Link>
                </div>
              ) : (
                recentJobs?.slice(0, 5).map(job => (
                  <div key={job.id} className="p-4 flex items-center justify-between hover:bg-zinc-900/50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-zinc-900 rounded flex items-center justify-center border border-zinc-800">
                        {job.mediaType === "video" ? <Video className="w-5 h-5 text-zinc-400" /> : <ImageIcon className="w-5 h-5 text-zinc-400" />}
                      </div>
                      <div>
                        <div className="font-medium text-sm text-zinc-200">{job.filename}</div>
                        <div className="text-xs text-zinc-500 flex items-center gap-2 mt-1">
                          <span className="capitalize">{job.enhancementType}</span>
                          <span>&bull;</span>
                          <span>{new Date(job.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-medium capitalize text-zinc-400 flex items-center gap-1">
                        {getStatusIcon(job.status)}
                        {job.status}
                      </span>
                      {job.status === "completed" && job.processedUrl && (
                        <a href={job.processedUrl} target="_blank" rel="noreferrer">
                          <Button size="sm" variant="ghost" className="h-8">View</Button>
                        </a>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
