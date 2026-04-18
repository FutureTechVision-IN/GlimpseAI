import React from "react";
import { motion } from "framer-motion";
import { useAuth } from "../lib/auth-context";
import { useGetUserUsage, useListMediaJobs } from "@workspace/api-client-react";
import { Link } from "wouter";
import Layout from "../components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Wand2, Image as ImageIcon, Video, Clock, ArrowRight, Zap,
  CheckCircle2, XCircle, Loader2, Shield, Sparkles, Camera, Film,
  TrendingUp, Crown,
} from "lucide-react";
import AiChatWidget from "../components/ai-chat-widget";

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data: usage, isLoading: isLoadingUsage } = useGetUserUsage();
  const { data: recentJobs, isLoading: isLoadingJobs } = useListMediaJobs({ status: "all" });

  const creditsUsed = usage?.creditsUsed || 0;
  const creditsLimit = usage?.creditsLimit || 1;
  const creditsPercent = Math.min((creditsUsed / creditsLimit) * 100, 100);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed": return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
      case "failed": return <XCircle className="w-4 h-4 text-red-400" />;
      case "processing": return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
      default: return <Clock className="w-4 h-4 text-zinc-500" />;
    }
  };

  const fadeUp = {
    hidden: { opacity: 0, y: 20 },
    visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.08, duration: 0.5, ease: "easeOut" as const } }),
  };

  return (
    <Layout>
      <div className="relative p-6 lg:p-8 max-w-7xl mx-auto w-full space-y-8 overflow-hidden">
        {/* Background ambient glow */}
        <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full bg-teal-500/5 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-40 -left-40 w-[400px] h-[400px] rounded-full bg-purple-500/5 blur-[100px]" />

        {/* Demo mode banner */}
        {import.meta.env.VITE_DEMO_MODE === "true" && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative flex items-center gap-3 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20 text-sm text-amber-300"
          >
            <Sparkles className="w-4 h-4 shrink-0 text-amber-400" />
            <span><strong>Demo Mode</strong> — Running on GitHub Pages with live mock data. Login with any credentials to explore.</span>
          </motion.div>
        )}

        {/* Hero Header */}
        <motion.header
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative flex flex-col lg:flex-row lg:items-end justify-between gap-6"
        >
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-gradient-to-r from-teal-500/20 to-cyan-500/20 text-teal-300 border border-teal-500/20">
                <Sparkles className="w-3 h-3" /> AI-Powered
              </span>
              {user?.role === "admin" && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-300 border border-amber-500/20">
                  <Crown className="w-3 h-3" /> Admin
                </span>
              )}
            </div>
            <h1 className="text-3xl lg:text-4xl font-bold tracking-tight bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
              {getGreeting()}, {user?.name?.split(' ')[0] || "Creator"}
            </h1>
            <p className="text-zinc-400 mt-2 text-sm lg:text-base">Your creative command center. Transform media with AI magic.</p>
          </div>
          <div className="flex items-center gap-3">
            {user?.role === "admin" && (
              <Link href="/admin">
                <Button variant="outline" className="border-zinc-700/60 text-zinc-300 hover:bg-zinc-800/80 backdrop-blur-sm">
                  <Shield className="w-4 h-4 mr-2" />
                  Admin
                </Button>
              </Link>
            )}
            <Link href="/photo-studio">
              <Button className="relative overflow-hidden bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white shadow-lg shadow-teal-500/25 transition-all hover:shadow-teal-500/40 hover:scale-[1.02]">
                <Wand2 className="w-4 h-4 mr-2" />
                New Enhancement
              </Button>
            </Link>
          </div>
        </motion.header>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Credits Ring Card */}
          <motion.div custom={0} variants={fadeUp} initial="hidden" animate="visible">
            <Card className="relative overflow-hidden bg-gradient-to-br from-zinc-900/90 to-zinc-950 border-zinc-800/60 backdrop-blur-sm hover:border-teal-500/30 transition-colors group">
              <div className="absolute inset-0 bg-gradient-to-br from-teal-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Credits</span>
                  <div className="w-8 h-8 rounded-full bg-teal-500/10 flex items-center justify-center">
                    <Zap className="w-4 h-4 text-teal-400" />
                  </div>
                </div>
                {isLoadingUsage ? (
                  <div className="h-12 bg-zinc-800/50 animate-pulse rounded-lg" />
                ) : (
                  <>
                    <div className="text-3xl font-bold text-white">{creditsUsed}</div>
                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${creditsPercent}%` }}
                          transition={{ duration: 1, ease: "easeOut", delay: 0.3 }}
                          className={`h-full rounded-full ${creditsPercent > 80 ? 'bg-gradient-to-r from-amber-500 to-red-500' : 'bg-gradient-to-r from-teal-500 to-cyan-400'}`}
                        />
                      </div>
                      <span className="text-[10px] text-zinc-500 font-mono">{creditsLimit}</span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Photos Card */}
          <motion.div custom={1} variants={fadeUp} initial="hidden" animate="visible">
            <Card className="relative overflow-hidden bg-gradient-to-br from-zinc-900/90 to-zinc-950 border-zinc-800/60 backdrop-blur-sm hover:border-blue-500/30 transition-colors group">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Photos</span>
                  <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                    <Camera className="w-4 h-4 text-blue-400" />
                  </div>
                </div>
                {isLoadingUsage ? (
                  <div className="h-12 bg-zinc-800/50 animate-pulse rounded-lg" />
                ) : (
                  <>
                    <div className="text-3xl font-bold text-white">{usage?.photoCount || 0}</div>
                    <p className="text-[11px] text-zinc-500 mt-2 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3 text-emerald-400" /> Enhanced this period
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Videos Card */}
          <motion.div custom={2} variants={fadeUp} initial="hidden" animate="visible">
            <Card className="relative overflow-hidden bg-gradient-to-br from-zinc-900/90 to-zinc-950 border-zinc-800/60 backdrop-blur-sm hover:border-purple-500/30 transition-colors group">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Videos</span>
                  <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center">
                    <Film className="w-4 h-4 text-purple-400" />
                  </div>
                </div>
                {isLoadingUsage ? (
                  <div className="h-12 bg-zinc-800/50 animate-pulse rounded-lg" />
                ) : (
                  <>
                    <div className="text-3xl font-bold text-white">{usage?.videoCount || 0}</div>
                    <p className="text-[11px] text-zinc-500 mt-2 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3 text-emerald-400" /> Enhanced this period
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Quick Actions Card */}
          <motion.div custom={3} variants={fadeUp} initial="hidden" animate="visible">
            <Card className="relative overflow-hidden bg-gradient-to-br from-zinc-900/90 to-zinc-950 border-zinc-800/60 backdrop-blur-sm hover:border-emerald-500/30 transition-colors group">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <CardContent className="p-5">
                <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Quick Actions</span>
                <div className="mt-3 space-y-2">
                  <Link href="/photo-studio">
                    <button className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-zinc-300 bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700/40 hover:border-teal-500/30 transition-all">
                      <ImageIcon className="w-3.5 h-3.5 text-teal-400" /> Enhance Photo
                    </button>
                  </Link>
                  <Link href="/video-studio">
                    <button className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-zinc-300 bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700/40 hover:border-purple-500/30 transition-all mt-2">
                      <Video className="w-3.5 h-3.5 text-purple-400" /> Edit Video
                    </button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Recent Activity */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35 }}
          className="space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-zinc-500" />
              Recent Activity
            </h2>
            <Link href="/history" className="text-xs text-teal-400 hover:text-teal-300 flex items-center gap-1 transition-colors">
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <Card className="overflow-hidden bg-gradient-to-br from-zinc-900/80 to-zinc-950 border-zinc-800/60 backdrop-blur-sm">
            <div className="divide-y divide-zinc-800/50">
              {isLoadingJobs ? (
                Array(3).fill(0).map((_, i) => (
                  <div key={i} className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-zinc-800/60 rounded-lg animate-pulse" />
                      <div className="space-y-2">
                        <div className="h-4 w-36 bg-zinc-800/60 animate-pulse rounded" />
                        <div className="h-3 w-24 bg-zinc-800/60 animate-pulse rounded" />
                      </div>
                    </div>
                  </div>
                ))
              ) : recentJobs?.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-teal-500/10 to-cyan-500/10 border border-teal-500/20 flex items-center justify-center">
                    <Sparkles className="w-7 h-7 text-teal-400/60" />
                  </div>
                  <p className="text-zinc-400 text-sm mb-1">No enhancements yet</p>
                  <p className="text-zinc-600 text-xs mb-4">Start creating magic with AI-powered editing</p>
                  <Link href="/photo-studio">
                    <Button size="sm" className="bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white text-xs">
                      <Wand2 className="w-3.5 h-3.5 mr-1.5" /> Create First Enhancement
                    </Button>
                  </Link>
                </div>
              ) : (
                recentJobs?.slice(0, 5).map((job, i) => (
                  <motion.div
                    key={job.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.4 + i * 0.06, duration: 0.3 }}
                    className="p-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center border ${
                        job.mediaType === "video"
                          ? "bg-purple-500/10 border-purple-500/20"
                          : "bg-blue-500/10 border-blue-500/20"
                      }`}>
                        {job.mediaType === "video"
                          ? <Video className="w-4.5 h-4.5 text-purple-400" />
                          : <ImageIcon className="w-4.5 h-4.5 text-blue-400" />}
                      </div>
                      <div>
                        <div className="font-medium text-sm text-zinc-200">{job.filename}</div>
                        <div className="text-[11px] text-zinc-500 flex items-center gap-2 mt-0.5">
                          <span className="capitalize px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-400">{job.enhancementType}</span>
                          <span>{new Date(job.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] font-medium capitalize text-zinc-400 flex items-center gap-1.5">
                        {getStatusIcon(job.status)}
                        {job.status}
                      </span>
                      {job.status === "completed" && job.processedUrl && (
                        <a href={job.processedUrl} target="_blank" rel="noreferrer">
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-teal-400 hover:text-teal-300 hover:bg-teal-500/10">View</Button>
                        </a>
                      )}
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </Card>
        </motion.div>
      </div>
      <AiChatWidget context="dashboard" />
    </Layout>
  );
}
