import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  useGetAdminStats,
  useListAdminUsers,
  useSuspendUser,
  useAdjustUserCredits,
  useListAdminJobs,
  useListAdminPayments,
  useListAdminPlans,
  useCreatePlan,
  useUpdatePlan,
  useListProviders,
  useCreateProvider,
  useUpdateProvider,
  useDeleteProvider,
  getListAdminUsersQueryKey,
  getListProvidersQueryKey,
  getListAdminPlansQueryKey,
  type Plan,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/auth-context";
import {
  LayoutDashboard, Users, Image as ImageIcon, CreditCard, Settings2,
  Cpu, ChevronRight, AlertCircle, CheckCircle, XCircle, RefreshCw,
  Plus, Pencil, Trash2, Eye, EyeOff, LogOut, Shield, TrendingUp,
  Activity, BarChart3, ArrowUpRight, ArrowDownRight, Search, Filter,
  Loader2, MoreHorizontal, Ban, BadgeDollarSign, Key, ToggleLeft, ToggleRight,
  FileWarning, Layers, BrainCircuit, Sparkles
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import AiChatWidget from "../components/ai-chat-widget";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend
} from "recharts";

type AdminSection =
  | "overview"
  | "users"
  | "jobs"
  | "payments"
  | "plans"
  | "providers"
  | "analytics"
  | "aiinsights";

function StatCard({
  title, value, sub, icon: Icon, trend, color = "teal"
}: {
  title: string; value: string | number; sub?: string;
  icon: React.ElementType; trend?: number; color?: string;
}) {
  const colors: Record<string, string> = {
    teal: "text-teal-400", emerald: "text-emerald-400",
    blue: "text-blue-400", amber: "text-amber-400", rose: "text-rose-400"
  };
  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{title}</p>
            <p className="text-3xl font-bold mt-1">{value}</p>
            {sub && <p className="text-xs text-zinc-500 mt-1">{sub}</p>}
            {trend !== undefined && (
              <span className={`text-xs flex items-center mt-1 ${trend >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {trend >= 0 ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                {Math.abs(trend)}% vs last week
              </span>
            )}
          </div>
          <div className={`p-2 rounded-lg bg-zinc-800 ${colors[color]}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        {description && <p className="text-sm text-zinc-400 mt-0.5">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    completed: { label: "Completed", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
    processing: { label: "Processing", className: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
    pending: { label: "Pending", className: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
    failed: { label: "Failed", className: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
    success: { label: "Success", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  };
  const cfg = map[status] ?? { label: status, className: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

// ─── OVERVIEW ───────────────────────────────────────────────────────────────
function Overview() {
  const { data: stats, isLoading } = useGetAdminStats();
  const [usageData, setUsageData] = useState<{ date: string; jobs: number; photos: number; videos: number; revenue: number; signups: number }[]>([]);
  const [funnelData, setFunnelData] = useState<{ registered: number; activated: number; converted: number; retained: number } | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("glimpse_token");
    if (!token) return;
    fetch("/api/admin/usage", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setUsageData(d.daily ?? [])).catch(() => {});
    fetch("/api/admin/funnel", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setFunnelData(d)).catch(() => {});
  }, []);

  const pieData = stats ? [
    { name: "Free", value: stats.freeUsers, color: "#6b7280" },
    { name: "Paid", value: stats.paidUsers, color: "#a855f7" },
  ] : [];

  const mediaPieData = stats ? [
    { name: "Photos", value: stats.totalPhotosProcessed, color: "#3b82f6" },
    { name: "Videos", value: stats.totalVideosProcessed, color: "#8b5cf6" },
  ] : [];

  const funnelSteps = funnelData ? [
    { label: "Registered", value: funnelData.registered, pct: 100 },
    { label: "Activated", value: funnelData.activated, pct: funnelData.registered > 0 ? Math.round(funnelData.activated / funnelData.registered * 100) : 0 },
    { label: "Converted", value: funnelData.converted, pct: funnelData.registered > 0 ? Math.round(funnelData.converted / funnelData.registered * 100) : 0 },
    { label: "Retained (7d)", value: funnelData.retained, pct: funnelData.registered > 0 ? Math.round(funnelData.retained / funnelData.registered * 100) : 0 },
  ] : [];

  if (isLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-teal-500" /></div>;
  }

  return (
    <div className="space-y-8">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Users" value={stats?.totalUsers.toLocaleString() ?? "—"} sub={`${stats?.freeUsers ?? 0} free · ${stats?.paidUsers ?? 0} paid`} icon={Users} color="teal" />
        <StatCard title="Revenue" value={stats ? `₹${(stats.totalRevenue / 100).toLocaleString("en-IN", { minimumFractionDigits: 0 })}` : "—"} sub={`${stats?.activeSubscriptions ?? 0} active subs`} icon={BadgeDollarSign} color="emerald" />
        <StatCard title="Media Processed" value={stats ? (stats.totalPhotosProcessed + stats.totalVideosProcessed).toLocaleString() : "—"} sub={`${stats?.totalPhotosProcessed ?? 0} photos · ${stats?.totalVideosProcessed ?? 0} videos`} icon={ImageIcon} color="blue" />
        <StatCard title="Jobs Today" value={stats?.jobsToday.toLocaleString() ?? "—"} sub={`${stats?.failedJobsToday ?? 0} failed`} icon={Activity} color={stats && stats.failedJobsToday > 0 ? "rose" : "amber"} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="bg-zinc-900 border-zinc-800 col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Daily Activity (30 days)</CardTitle>
          </CardHeader>
          <CardContent>
            {usageData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={usageData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gJobs" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gSignups" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71717a" }} tickFormatter={d => d.slice(5)} />
                  <YAxis tick={{ fontSize: 10, fill: "#71717a" }} allowDecimals={false} />
                  <RechartsTooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }} labelStyle={{ color: "#a1a1aa" }} itemStyle={{ color: "#e4e4e7" }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "#a1a1aa" }} />
                  <Area type="monotone" dataKey="jobs" name="Jobs" stroke="#a855f7" fill="url(#gJobs)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="signups" name="Signups" stroke="#3b82f6" fill="url(#gSignups)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-zinc-600 text-sm">No activity data yet</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-base">User Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {stats && stats.totalUsers > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={140}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" innerRadius={40} outerRadius={60} paddingAngle={3} strokeWidth={0}>
                      {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <RechartsTooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2">
                  {pieData.map(d => (
                    <div key={d.name} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ background: d.color }} />{d.name}</span>
                      <span className="text-zinc-400">{d.value} ({stats.totalUsers > 0 ? Math.round(d.value / stats.totalUsers * 100) : 0}%)</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-[140px] flex items-center justify-center text-zinc-600 text-sm">No users yet</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Media breakdown + Conversion funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-base">Media Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {usageData.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={usageData.slice(-14)} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71717a" }} tickFormatter={d => d.slice(5)} />
                  <YAxis tick={{ fontSize: 10, fill: "#71717a" }} allowDecimals={false} />
                  <RechartsTooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }} labelStyle={{ color: "#a1a1aa" }} itemStyle={{ color: "#e4e4e7" }} />
                  <Bar dataKey="photos" name="Photos" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="videos" name="Videos" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[180px] flex items-center justify-center text-zinc-600 text-sm">No data yet</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-base">Conversion Funnel</CardTitle>
            <CardDescription className="text-xs text-zinc-500">From registration to active paid user</CardDescription>
          </CardHeader>
          <CardContent>
            {funnelSteps.length > 0 ? (
              <div className="space-y-4 mt-1">
                {funnelSteps.map((step, i) => (
                  <div key={step.label}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-zinc-300">{step.label}</span>
                      <span className="text-zinc-400">{step.value.toLocaleString()} <span className="text-zinc-600 text-xs">({step.pct}%)</span></span>
                    </div>
                    <Progress value={step.pct} className="h-2" style={{ "--progress-color": ["#a855f7", "#8b5cf6", "#7c3aed", "#6d28d9"][i] } as React.CSSProperties} />
                  </div>
                ))}
                <div className="pt-2 border-t border-zinc-800">
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-500">Conversion rate</span>
                    <span className="text-teal-400 font-semibold">{stats?.conversionRate ? `${(stats.conversionRate * 100).toFixed(1)}%` : "0%"}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-[140px] flex items-center justify-center text-zinc-600 text-sm">No funnel data</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader><CardTitle className="text-base">Recent Signups</CardTitle></CardHeader>
          <CardContent>
            {stats?.recentSignups.length === 0 && <p className="text-sm text-zinc-500 text-center py-6">No signups yet</p>}
            <div className="space-y-3">
              {stats?.recentSignups.map(u => (
                <div key={u.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-sm font-bold text-teal-400">{u.name[0]}</div>
                    <div>
                      <div className="text-sm font-medium">{u.name}</div>
                      <div className="text-xs text-zinc-500">{u.email}</div>
                    </div>
                  </div>
                  <div className="text-xs text-zinc-500">{new Date(u.createdAt).toLocaleDateString("en-IN")}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader><CardTitle className="text-base">Recent Payments</CardTitle></CardHeader>
          <CardContent>
            {stats?.recentPayments.length === 0 && <p className="text-sm text-zinc-500 text-center py-6">No payments yet</p>}
            <div className="space-y-3">
              {stats?.recentPayments.map(p => (
                <div key={p.id} className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-emerald-400">+₹{(p.amount / 100).toLocaleString("en-IN")}</div>
                    <div className="text-xs text-zinc-500">{p.billingPeriod ?? "one-time"}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={p.status} />
                    <span className="text-xs text-zinc-600">{new Date(p.createdAt).toLocaleDateString("en-IN")}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── USERS ──────────────────────────────────────────────────────────────────
function UsersSection() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [creditDialog, setCreditDialog] = useState<{
    userId: number;
    name: string;
    currentMonthly: number;
    currentDaily: number;
  } | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [dailyAmount, setDailyAmount] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useListAdminUsers({ page, limit: 20, search: search || undefined });
  const suspendMutation = useSuspendUser();
  const creditMutation = useAdjustUserCredits();

  const handleSuspend = async (userId: number, suspend: boolean, name: string) => {
    await suspendMutation.mutateAsync({ id: userId, data: { suspend } });
    toast({ title: suspend ? `${name} suspended` : `${name} unsuspended` });
    qc.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
  };

  const handleCredits = async () => {
    if (!creditDialog) return;
    const credits = parseInt(creditAmount, 10);
    const daily = parseInt(dailyAmount, 10);
    if (isNaN(credits) || credits < 0) { toast({ title: "Enter a valid monthly credit limit", variant: "destructive" }); return; }
    // Send both monthly and daily (backend accepts dailyLimit as an extra field)
    await creditMutation.mutateAsync({
      id: creditDialog.userId,
      data: { credits, ...(isNaN(daily) ? {} : { dailyLimit: daily }) } as any,
    });
    toast({ title: `Quota updated for ${creditDialog.name}` });
    qc.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
    setCreditDialog(null);
    setCreditAmount("");
    setDailyAmount("");
  };

  return (
    <div>
      <SectionHeader title="User Management" description={`${data?.total ?? 0} total users`} />
      <div className="flex gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <Input
            placeholder="Search by email..."
            className="pl-9 bg-zinc-900 border-zinc-700"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { setSearch(searchInput); setPage(1); } }}
          />
        </div>
        <Button variant="secondary" size="sm" className="bg-zinc-800 text-zinc-300" onClick={() => { setSearch(searchInput); setPage(1); }}>Search</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-teal-500" /></div>
      ) : (
        <Card className="bg-zinc-900 border-zinc-800 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-500">User</TableHead>
                <TableHead className="text-zinc-500">Role</TableHead>
                <TableHead className="text-zinc-500">Plan</TableHead>
                <TableHead className="text-zinc-500">Monthly Quota</TableHead>
                <TableHead className="text-zinc-500 hidden lg:table-cell">Daily Quota</TableHead>
                <TableHead className="text-zinc-500">Status</TableHead>
                <TableHead className="text-zinc-500 hidden sm:table-cell">Joined</TableHead>
                <TableHead className="text-zinc-500 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.users.map(user => (
                <TableRow key={user.id} className="border-zinc-800 hover:bg-zinc-800/40">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-sm font-bold text-teal-400 shrink-0">{user.name[0]}</div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate max-w-[120px]">{user.name}</div>
                        <div className="text-xs text-zinc-500 truncate max-w-[120px]">{user.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={user.role === "admin" ? "border-teal-500/40 text-teal-400 bg-teal-500/10" : "border-zinc-700 text-zinc-400"}>
                      {user.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-zinc-400">{user.planId ? "Paid" : "Free"}</span>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{user.creditsUsed} / {user.creditsLimit}</div>
                    <Progress value={user.creditsLimit > 0 ? (user.creditsUsed / user.creditsLimit) * 100 : 0} className="h-1 mt-1 w-16" />
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {(user as any).dailyLimit ? (
                      <>
                        <div className="text-sm">{(user as any).dailyCreditsUsed ?? 0} / {(user as any).dailyLimit}</div>
                        <Progress value={((user as any).dailyLimit) > 0 ? (((user as any).dailyCreditsUsed ?? 0) / (user as any).dailyLimit) * 100 : 0} className="h-1 mt-1 w-16" />
                      </>
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {user.isSuspended
                      ? <span className="text-xs text-rose-400 flex items-center gap-1"><XCircle className="w-3 h-3" /> Suspended</span>
                      : <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Active</span>}
                  </TableCell>
                  <TableCell className="text-xs text-zinc-500 hidden sm:table-cell">{new Date(user.createdAt).toLocaleDateString("en-IN")}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" variant="ghost" className="text-zinc-400 hover:text-blue-400 hover:bg-blue-500/10 text-xs h-7 px-2"
                        onClick={() => {
                          setCreditDialog({ userId: user.id, name: user.name, currentMonthly: user.creditsLimit, currentDaily: (user as any).dailyLimit ?? 5 });
                          setCreditAmount(String(user.creditsLimit));
                          setDailyAmount(String((user as any).dailyLimit ?? 5));
                        }}>
                        <Key className="w-3 h-3 mr-1" /> Quota
                      </Button>
                      <Button size="sm" variant="ghost"
                        className={`text-xs h-7 px-2 ${user.isSuspended ? "text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10" : "text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10"}`}
                        onClick={() => handleSuspend(user.id, !user.isSuspended, user.name)}
                        disabled={suspendMutation.isPending}>
                        {user.isSuspended ? <><CheckCircle className="w-3 h-3 mr-1" /> Restore</> : <><Ban className="w-3 h-3 mr-1" /> Suspend</>}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {data?.users.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center py-12 text-zinc-500">No users found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800">
              <span className="text-xs text-zinc-500">Page {page} of {data.totalPages}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="border-zinc-700 h-7 text-xs" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</Button>
                <Button size="sm" variant="outline" className="border-zinc-700 h-7 text-xs" onClick={() => setPage(p => p + 1)} disabled={page >= data.totalPages}>Next</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Quota adjustment dialog — monthly + daily */}
      <Dialog open={!!creditDialog} onOpenChange={open => { if (!open) { setCreditDialog(null); setCreditAmount(""); setDailyAmount(""); } }}>
        <DialogContent className="bg-zinc-900 border-zinc-800 max-w-sm w-full">
          <DialogHeader>
            <DialogTitle>Adjust Quota</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Manually override usage limits for <span className="text-white font-medium">{creditDialog?.name}</span>.
              Admins are exempt from these limits themselves.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm text-zinc-300">Monthly credit limit</Label>
              <Input
                type="number"
                min={0}
                value={creditAmount}
                onChange={e => setCreditAmount(e.target.value)}
                className="bg-zinc-800 border-zinc-700"
                placeholder="e.g. 600"
              />
              <p className="text-xs text-zinc-500">Current: {creditDialog?.currentMonthly ?? "—"} credits/month</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-zinc-300">Daily credit limit</Label>
              <Input
                type="number"
                min={0}
                value={dailyAmount}
                onChange={e => setDailyAmount(e.target.value)}
                className="bg-zinc-800 border-zinc-700"
                placeholder="e.g. 20"
              />
              <p className="text-xs text-zinc-500">Current: {creditDialog?.currentDaily ?? "—"} credits/day</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-zinc-700" onClick={() => { setCreditDialog(null); setCreditAmount(""); setDailyAmount(""); }}>Cancel</Button>
            <Button className="bg-teal-600 hover:bg-teal-500" onClick={handleCredits} disabled={creditMutation.isPending}>
              {creditMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── JOBS ───────────────────────────────────────────────────────────────────
function JobsSection() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useListAdminJobs({ status: statusFilter !== "all" ? statusFilter : undefined, page });

  return (
    <div>
      <SectionHeader title="Job Monitoring" description="All media processing jobs across users" />
      <div className="flex gap-2 mb-5">
        {["all", "pending", "processing", "completed", "failed"].map(s => (
          <Button key={s} size="sm" variant="ghost"
            className={`capitalize h-7 px-3 text-xs rounded-full ${statusFilter === s ? "bg-teal-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
            onClick={() => { setStatusFilter(s); setPage(1); }}>
            {s === "all" ? "All Jobs" : s}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-teal-500" /></div>
      ) : (
        <Card className="bg-zinc-900 border-zinc-800">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-500">ID</TableHead>
                <TableHead className="text-zinc-500">Type</TableHead>
                <TableHead className="text-zinc-500">Filename</TableHead>
                <TableHead className="text-zinc-500">Enhancement</TableHead>
                <TableHead className="text-zinc-500">Status</TableHead>
                <TableHead className="text-zinc-500">Processing</TableHead>
                <TableHead className="text-zinc-500">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.jobs.map(job => (
                <TableRow key={job.id} className={`border-zinc-800 hover:bg-zinc-800/40 ${job.status === "failed" ? "bg-rose-950/10" : ""}`}>
                  <TableCell className="text-xs text-zinc-500 font-mono">#{job.id}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={job.mediaType === "photo" ? "border-blue-500/30 text-blue-400 bg-blue-500/5" : "border-violet-500/30 text-violet-400 bg-violet-500/5"}>
                      {job.mediaType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm max-w-[160px] truncate" title={job.filename}>{job.filename}</TableCell>
                  <TableCell className="text-xs text-zinc-400">{job.enhancementType ?? "—"}</TableCell>
                  <TableCell><StatusBadge status={job.status} /></TableCell>
                  <TableCell className="text-xs text-zinc-500">{job.processingTimeMs ? `${(job.processingTimeMs / 1000).toFixed(1)}s` : "—"}</TableCell>
                  <TableCell className="text-xs text-zinc-500">{new Date(job.createdAt).toLocaleString("en-IN")}</TableCell>
                </TableRow>
              ))}
              {data?.jobs.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center py-12 text-zinc-500">No jobs found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800">
              <span className="text-xs text-zinc-500">Page {page} of {data.totalPages}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="border-zinc-700 h-7 text-xs" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</Button>
                <Button size="sm" variant="outline" className="border-zinc-700 h-7 text-xs" onClick={() => setPage(p => p + 1)} disabled={page >= data.totalPages}>Next</Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ─── PAYMENTS ───────────────────────────────────────────────────────────────
function PaymentsSection() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useListAdminPayments({ page, limit: 30 });

  const totalRevenue = data?.payments.filter(p => p.status === "success").reduce((s, p) => s + p.amount, 0) ?? 0;

  return (
    <div>
      <SectionHeader title="Payment Activity" description="All payment transactions" />
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard title="Total Revenue" value={`₹${(totalRevenue / 100).toLocaleString("en-IN")}`} icon={BadgeDollarSign} color="emerald" />
        <StatCard title="Transactions" value={data?.total ?? "—"} icon={CreditCard} color="blue" />
        <StatCard title="Success Rate" value={data ? `${data.payments.length > 0 ? Math.round(data.payments.filter(p => p.status === "success").length / data.payments.length * 100) : 0}%` : "—"} icon={TrendingUp} color="teal" />
      </div>
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-teal-500" /></div>
      ) : (
        <Card className="bg-zinc-900 border-zinc-800">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-500">Order ID</TableHead>
                <TableHead className="text-zinc-500">User ID</TableHead>
                <TableHead className="text-zinc-500">Amount</TableHead>
                <TableHead className="text-zinc-500">Period</TableHead>
                <TableHead className="text-zinc-500">Status</TableHead>
                <TableHead className="text-zinc-500">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.payments.map(p => (
                <TableRow key={p.id} className="border-zinc-800 hover:bg-zinc-800/40">
                  <TableCell className="text-xs font-mono text-zinc-500 max-w-[140px] truncate">{p.razorpayOrderId ?? `#${p.id}`}</TableCell>
                  <TableCell className="text-sm text-zinc-400">User #{p.userId}</TableCell>
                  <TableCell className="text-sm font-semibold text-emerald-400">₹{(p.amount / 100).toLocaleString("en-IN")}</TableCell>
                  <TableCell className="text-xs text-zinc-400 capitalize">{p.billingPeriod ?? "—"}</TableCell>
                  <TableCell><StatusBadge status={p.status} /></TableCell>
                  <TableCell className="text-xs text-zinc-500">{new Date(p.createdAt).toLocaleString("en-IN")}</TableCell>
                </TableRow>
              ))}
              {data?.payments.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center py-12 text-zinc-500">No payments yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800">
              <span className="text-xs text-zinc-500">Page {page} of {data.totalPages}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="border-zinc-700 h-7 text-xs" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</Button>
                <Button size="sm" variant="outline" className="border-zinc-700 h-7 text-xs" onClick={() => setPage(p => p + 1)} disabled={page >= data.totalPages}>Next</Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ─── PLANS ──────────────────────────────────────────────────────────────────
function PlansSection() {
  const { data: plans, isLoading } = useListAdminPlans();
  const createMutation = useCreatePlan();
  const updateMutation = useUpdatePlan();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [editPlan, setEditPlan] = useState<Plan | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", description: "", priceMonthly: "", priceAnnual: "", creditsPerMonth: "", features: "", isPopular: false });

  const resetForm = () => setForm({ name: "", slug: "", description: "", priceMonthly: "", priceAnnual: "", creditsPerMonth: "", features: "", isPopular: false });

  const openEdit = (plan: NonNullable<typeof editPlan>) => {
    setEditPlan(plan);
    setForm({
      name: plan.name, slug: plan.slug, description: plan.description,
      priceMonthly: String(plan.priceMonthly), priceAnnual: String(plan.priceAnnual),
      creditsPerMonth: String(plan.creditsPerMonth),
      features: plan.features.join("\n"), isPopular: plan.isPopular
    });
  };

  const handleSave = async () => {
    const payload = {
      name: form.name, slug: form.slug, description: form.description,
      priceMonthly: parseInt(form.priceMonthly), priceAnnual: parseInt(form.priceAnnual),
      creditsPerMonth: parseInt(form.creditsPerMonth),
      features: form.features.split("\n").map(s => s.trim()).filter(Boolean),
      isPopular: form.isPopular,
    };
    if (editPlan) {
      await updateMutation.mutateAsync({ id: editPlan.id, data: payload });
      toast({ title: "Plan updated" });
    } else {
      await createMutation.mutateAsync({ data: payload });
      toast({ title: "Plan created" });
    }
    qc.invalidateQueries({ queryKey: getListAdminPlansQueryKey() });
    setEditPlan(null);
    setShowCreate(false);
    resetForm();
  };

  const dialogOpen = !!editPlan || showCreate;

  return (
    <div>
      <SectionHeader title="Plan Management" description="Manage subscription tiers and pricing"
        action={<Button size="sm" className="bg-teal-600 hover:bg-teal-500" onClick={() => { resetForm(); setShowCreate(true); }}><Plus className="w-4 h-4 mr-1" /> New Plan</Button>} />

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-teal-500" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {plans?.map(plan => (
            <Card key={plan.id} className={`bg-zinc-900 border-zinc-800 relative ${plan.isPopular ? "ring-1 ring-teal-500/50" : ""}`}>
              {plan.isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-teal-600 text-white text-xs px-3">Most Popular</Badge>
                </div>
              )}
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{plan.name}</CardTitle>
                    <CardDescription className="text-zinc-500 text-xs mt-1">{plan.description}</CardDescription>
                  </div>
                  <Badge variant="outline" className={plan.isActive ? "border-emerald-500/30 text-emerald-400" : "border-zinc-700 text-zinc-500"}>
                    {plan.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <div className="mt-3">
                  <span className="text-2xl font-bold">₹{(plan.priceMonthly / 100).toLocaleString("en-IN")}</span>
                  <span className="text-zinc-500 text-sm">/mo</span>
                </div>
                <div className="text-xs text-zinc-500">₹{(plan.priceAnnual / 100).toLocaleString("en-IN")}/yr · {plan.creditsPerMonth} credits/mo</div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 mb-4">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm text-zinc-400">
                      <CheckCircle className="w-3.5 h-3.5 text-teal-400 mt-0.5 shrink-0" />{f}
                    </li>
                  ))}
                </ul>
                <Button size="sm" variant="outline" className="w-full border-zinc-700 text-zinc-300" onClick={() => openEdit(plan)}>
                  <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit Plan
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={open => { if (!open) { setEditPlan(null); setShowCreate(false); } }}>
        <DialogContent className="bg-zinc-900 border-zinc-800 max-w-lg">
          <DialogHeader>
            <DialogTitle>{editPlan ? "Edit Plan" : "Create Plan"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-zinc-400">Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="bg-zinc-800 border-zinc-700 mt-1" /></div>
              <div><Label className="text-xs text-zinc-400">Slug</Label><Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} className="bg-zinc-800 border-zinc-700 mt-1" /></div>
            </div>
            <div><Label className="text-xs text-zinc-400">Description</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="bg-zinc-800 border-zinc-700 mt-1" /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs text-zinc-400">Monthly (paise)</Label><Input type="number" value={form.priceMonthly} onChange={e => setForm(f => ({ ...f, priceMonthly: e.target.value }))} className="bg-zinc-800 border-zinc-700 mt-1" /></div>
              <div><Label className="text-xs text-zinc-400">Annual (paise)</Label><Input type="number" value={form.priceAnnual} onChange={e => setForm(f => ({ ...f, priceAnnual: e.target.value }))} className="bg-zinc-800 border-zinc-700 mt-1" /></div>
              <div><Label className="text-xs text-zinc-400">Credits/mo</Label><Input type="number" value={form.creditsPerMonth} onChange={e => setForm(f => ({ ...f, creditsPerMonth: e.target.value }))} className="bg-zinc-800 border-zinc-700 mt-1" /></div>
            </div>
            <div><Label className="text-xs text-zinc-400">Features (one per line)</Label><Textarea value={form.features} onChange={e => setForm(f => ({ ...f, features: e.target.value }))} className="bg-zinc-800 border-zinc-700 mt-1 text-sm" rows={5} /></div>
            <div className="flex items-center gap-2"><Switch checked={form.isPopular} onCheckedChange={v => setForm(f => ({ ...f, isPopular: v }))} /><Label className="text-sm">Mark as Popular</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-zinc-700" onClick={() => { setEditPlan(null); setShowCreate(false); }}>Cancel</Button>
            <Button className="bg-teal-600 hover:bg-teal-500" onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
              {(createMutation.isPending || updateMutation.isPending) ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── PROVIDERS ──────────────────────────────────────────────────────────────
function ProvidersSection() {
  const { data: providers, isLoading } = useListProviders();
  const createMutation = useCreateProvider();
  const updateMutation = useUpdateProvider();
  const deleteMutation = useDeleteProvider();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [showCreate, setShowCreate] = useState(false);
  const [showKeyDialog, setShowKeyDialog] = useState<{ id: number; name: string } | null>(null);
  const [newKey, setNewKey] = useState("");
  const [form, setForm] = useState({ name: "", slug: "", apiKey: "", priority: "1" });
  const [showKeys, setShowKeys] = useState<Record<number, boolean>>({});

  const handleToggle = async (id: number, isEnabled: boolean, name: string) => {
    await updateMutation.mutateAsync({ id, data: { isEnabled } });
    toast({ title: isEnabled ? `${name} enabled` : `${name} disabled` });
    qc.invalidateQueries({ queryKey: getListProvidersQueryKey() });
  };

  const handleCreate = async () => {
    await createMutation.mutateAsync({ data: { name: form.name, slug: form.slug, apiKey: form.apiKey, priority: parseInt(form.priority) } });
    toast({ title: "Provider added" });
    qc.invalidateQueries({ queryKey: getListProvidersQueryKey() });
    setShowCreate(false);
    setForm({ name: "", slug: "", apiKey: "", priority: "1" });
  };

  const handleRotateKey = async () => {
    if (!showKeyDialog || !newKey.trim()) return;
    await updateMutation.mutateAsync({ id: showKeyDialog.id, data: { apiKey: newKey } });
    toast({ title: `API key rotated for ${showKeyDialog.name}` });
    qc.invalidateQueries({ queryKey: getListProvidersQueryKey() });
    setShowKeyDialog(null);
    setNewKey("");
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete provider "${name}"?`)) return;
    await deleteMutation.mutateAsync({ id });
    toast({ title: `${name} deleted` });
    qc.invalidateQueries({ queryKey: getListProvidersQueryKey() });
  };

  return (
    <div>
      <SectionHeader title="AI Provider Management" description="Configure and monitor AI API providers"
        action={<Button size="sm" className="bg-teal-600 hover:bg-teal-500" onClick={() => setShowCreate(true)}><Plus className="w-4 h-4 mr-1" /> Add Provider</Button>} />

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-teal-500" /></div>
      ) : (
        <div className="space-y-4">
          {providers?.length === 0 && (
            <Card className="bg-zinc-900 border-zinc-800">
              <CardContent className="flex flex-col items-center justify-center py-16 text-zinc-500 space-y-3">
                <Cpu className="w-10 h-10 opacity-30" />
                <p>No AI providers configured</p>
                <Button size="sm" className="bg-teal-600 hover:bg-teal-500" onClick={() => setShowCreate(true)}>Add your first provider</Button>
              </CardContent>
            </Card>
          )}
          {providers?.map(provider => (
            <Card key={provider.id} className={`bg-zinc-900 border-zinc-800 ${!provider.isEnabled ? "opacity-60" : ""}`}>
              <CardContent className="pt-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center">
                      <Cpu className="w-5 h-5 text-teal-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{provider.name}</span>
                        <Badge variant="outline" className="text-xs font-mono border-zinc-700 text-zinc-500">{provider.slug}</Badge>
                        <Badge variant="outline" className={`text-xs ${provider.isEnabled ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/5" : "border-zinc-700 text-zinc-500"}`}>
                          {provider.isEnabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-5 mt-1 text-xs text-zinc-500">
                        <span>Priority: <span className="text-zinc-300">{provider.priority}</span></span>
                        <span>Requests: <span className="text-zinc-300">{provider.requestCount.toLocaleString()}</span></span>
                        <span>Errors: <span className={provider.errorCount > 0 ? "text-rose-400" : "text-zinc-300"}>{provider.errorCount}</span></span>
                        {provider.lastUsedAt && <span>Last used: <span className="text-zinc-300">{new Date(provider.lastUsedAt).toLocaleDateString("en-IN")}</span></span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <span>{provider.isEnabled ? "On" : "Off"}</span>
                      <Switch checked={provider.isEnabled} onCheckedChange={v => handleToggle(provider.id, v, provider.name)} />
                    </div>
                    <Button size="sm" variant="outline" className="border-zinc-700 text-zinc-300 h-8 text-xs" onClick={() => { setShowKeyDialog({ id: provider.id, name: provider.name }); setNewKey(""); }}>
                      <Key className="w-3.5 h-3.5 mr-1.5" /> Rotate Key
                    </Button>
                    <Button size="sm" variant="ghost" className="text-rose-400 hover:bg-rose-500/10 h-8 w-8 p-0" onClick={() => handleDelete(provider.id, provider.name)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {provider.errorCount > 0 && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-rose-400 bg-rose-500/5 border border-rose-500/20 rounded-lg px-3 py-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {provider.errorCount} error{provider.errorCount > 1 ? "s" : ""} recorded. Consider rotating the API key or checking the provider status.
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create provider */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-zinc-900 border-zinc-800">
          <DialogHeader>
            <DialogTitle>Add AI Provider</DialogTitle>
            <DialogDescription className="text-zinc-400">Configure a new AI API provider</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-zinc-400">Provider Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Gemini Pro" className="bg-zinc-800 border-zinc-700 mt-1" /></div>
              <div><Label className="text-xs text-zinc-400">Slug</Label><Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="e.g. gemini-pro" className="bg-zinc-800 border-zinc-700 mt-1" /></div>
            </div>
            <div><Label className="text-xs text-zinc-400">API Key</Label><Input type="password" value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))} placeholder="sk-..." className="bg-zinc-800 border-zinc-700 mt-1 font-mono" /></div>
            <div><Label className="text-xs text-zinc-400">Priority (1 = highest)</Label><Input type="number" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className="bg-zinc-800 border-zinc-700 mt-1 w-24" min={1} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-zinc-700" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button className="bg-teal-600 hover:bg-teal-500" onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add Provider"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rotate key */}
      <Dialog open={!!showKeyDialog} onOpenChange={open => !open && setShowKeyDialog(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-800">
          <DialogHeader>
            <DialogTitle>Rotate API Key</DialogTitle>
            <DialogDescription className="text-zinc-400">Enter the new API key for {showKeyDialog?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label className="text-xs text-zinc-400">New API Key</Label>
            <Input type="password" value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="New key..." className="bg-zinc-800 border-zinc-700 font-mono" />
            <p className="text-xs text-zinc-500">The old key will be replaced immediately. Make sure the new key is valid before saving.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-zinc-700" onClick={() => setShowKeyDialog(null)}>Cancel</Button>
            <Button className="bg-teal-600 hover:bg-teal-500" onClick={handleRotateKey} disabled={!newKey.trim() || updateMutation.isPending}>
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Rotate Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── API KEYS (In-Memory Key Manager) ────────────────────────────────────────
function ApiKeysSection() {
  const [keys, setKeys] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState({ keys: "", provider: "openrouter", model: "moonshotai/kimi-k2.5", tier: "free" });
  const [validating, setValidating] = useState(false);
  const [usageReport, setUsageReport] = useState<any>(null);
  const { toast } = useToast();

  const token = localStorage.getItem("glimpse_token");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // All available models grouped by priority
  const AVAILABLE_MODELS = [
    { id: "moonshotai/kimi-k2.5", label: "Kimi K2.5 (Primary — vision+reasoning)", group: "primary" },
    { id: "openrouter/elephant-alpha", label: "Elephant Alpha (Primary — multimodal)", group: "primary" },
    { id: "bytedance/seedance-2.0", label: "Seedance 2.0 (Primary — video+image)", group: "primary" },
    { id: "alibaba/wan-2.7", label: "WAN 2.7 (Primary — video enhancement)", group: "primary" },
    { id: "stepfun/step-3.5-flash:free", label: "Step 3.5 Flash (Standard — free)", group: "standard" },
    { id: "nvidia/nemotron-3-super-120b-a12b:free", label: "Nemotron Super 120B (Standard — free)", group: "standard" },
    { id: "nvidia/nemotron-3-nano-30b-a3b:free", label: "Nemotron Nano 30B (Standard — free)", group: "standard" },
    { id: "z-ai/glm-4.5-air:free", label: "GLM 4.5 Air (Standard — free)", group: "standard" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash (Gemini — last resort)", group: "gemini" },
  ];

  const fetchKeys = async () => {
    setIsLoading(true);
    try {
      const [keysRes, statusRes, reportRes] = await Promise.all([
        fetch("/api/admin/provider-keys", { headers }),
        fetch("/api/admin/provider-keys/status", { headers }),
        fetch("/api/admin/provider-keys/usage-report", { headers }),
      ]);
      const keysData = await keysRes.json();
      const statusData = await statusRes.json();
      setKeys(keysData.keys ?? []);
      setStatus(statusData);
      if (reportRes.ok) setUsageReport(await reportRes.json());
    } catch { /* ignore */ }
    setIsLoading(false);
  };

  useEffect(() => { fetchKeys(); }, []);

  const handleValidateAll = async () => {
    setValidating(true);
    try {
      await fetch("/api/admin/provider-keys/validate-all", { method: "POST", headers });
      toast({ title: "Validation complete" });
      await fetchKeys();
    } catch {}
    setValidating(false);
  };

  const handleLoadEnv = async () => {
    try {
      await fetch("/api/admin/provider-keys/load-env", { method: "POST", headers });
      toast({ title: "Keys reloaded from .env" });
      await fetchKeys();
    } catch {}
  };

  const handleToggleStatus = async (id: number, currentStatus: string) => {
    const newStatus = currentStatus === "active" ? "inactive" : "active";
    await fetch(`/api/admin/provider-keys/${id}/status`, {
      method: "PATCH", headers, body: JSON.stringify({ status: newStatus }),
    });
    await fetchKeys();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Remove this key?")) return;
    await fetch(`/api/admin/provider-keys/${id}`, { method: "DELETE", headers });
    toast({ title: "Key removed" });
    await fetchKeys();
  };

  /**
   * Smart bulk import:
   * - Accepts keys one-per-line OR space-separated OR mixed paste with model names
   * - Automatically filters out non-key tokens (model names, labels, blank tokens)
   * - Sends the raw text to backend which tokenizes correctly
   */
  const handleBulkImport = async () => {
    if (!bulkForm.keys.trim()) return;
    // Send all lines as array — backend will tokenize by whitespace and filter non-keys
    const lines = bulkForm.keys.split("\n").map(k => k.trim()).filter(k => k.length > 0);
    if (lines.length === 0) return;
    const res = await fetch("/api/admin/provider-keys/bulk-import", {
      method: "POST", headers,
      body: JSON.stringify({ keys: lines, provider: bulkForm.provider, model: bulkForm.model, tier: bulkForm.tier }),
    });
    const data = await res.json();
    toast({
      title: `${data.added} key${data.added === 1 ? "" : "s"} imported`,
      description: `Total in pool: ${data.totalKeys}. Run Validate All to activate.`,
    });
    setBulkOpen(false);
    setBulkForm({ keys: "", provider: "openrouter", model: "moonshotai/kimi-k2.5", tier: "free" });
    await fetchKeys();
  };

  const statusColor = (s: string) => {
    if (s === "active") return "border-emerald-500/30 text-emerald-400 bg-emerald-500/5";
    if (s === "degraded") return "border-amber-500/30 text-amber-400 bg-amber-500/5";
    if (s === "validating") return "border-blue-500/30 text-blue-400 bg-blue-500/5";
    return "border-zinc-700 text-zinc-500";
  };

  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-teal-500" /></div>;

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-6">
      <SectionHeader title="API Key Management" description="View, add, and manage provider API keys with health monitoring"
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="border-zinc-700" onClick={handleLoadEnv}>
              <RefreshCw className="w-4 h-4 mr-1" /> Reload .env
            </Button>
            <Button size="sm" variant="outline" className="border-zinc-700" onClick={handleValidateAll} disabled={validating}>
              {validating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Activity className="w-4 h-4 mr-1" />}
              Validate All
            </Button>
            <Button size="sm" className="bg-teal-600 hover:bg-teal-500" onClick={() => setBulkOpen(true)}>
              <Plus className="w-4 h-4 mr-1" /> Bulk Import
            </Button>
          </div>
        }
      />

      {/* Status overview cards */}
      {status && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Total Keys" value={status.totalKeys} icon={Key} color="teal" />
          <StatCard title="Active" value={status.active} icon={CheckCircle} color="emerald" />
          <StatCard title="Degraded" value={status.degraded} icon={AlertCircle} color="amber" />
          <StatCard title="Inactive" value={status.inactive} icon={XCircle} color="rose" />
        </div>
      )}

      {/* Provider & Tier breakdown */}
      {status && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader><CardTitle className="text-sm">By Provider</CardTitle></CardHeader>
            <CardContent>
              {status.byProvider?.map((p: any) => (
                <div key={p.provider} className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0">
                  <span className="text-sm font-medium capitalize">{p.provider}</span>
                  <div className="flex gap-3 text-xs text-zinc-400">
                    <span>{p.active}/{p.total} active</span>
                    <span>{p.totalCalls.toLocaleString()} calls</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader><CardTitle className="text-sm">By Tier</CardTitle></CardHeader>
            <CardContent>
              {status.byTier?.map((t: any) => (
                <div key={t.tier} className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0">
                  <span className="text-sm font-medium capitalize">{t.tier}</span>
                  <span className="text-xs text-zinc-400">{t.active}/{t.total} active</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Degraded keys diagnostic banner */}
      {keys.filter((k: any) => k.status === "degraded").length > 0 && (
        <Card className="bg-amber-500/5 border-amber-500/20">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-300 mb-1">
                  {keys.filter((k: any) => k.status === "degraded").length} key{keys.filter((k: any) => k.status === "degraded").length > 1 ? "s" : ""} degraded
                </p>
                <div className="space-y-1">
                  {keys.filter((k: any) => k.status === "degraded").slice(0, 5).map((k: any) => (
                    <p key={k.id} className="text-xs text-zinc-400">
                      <span className="font-mono text-amber-400/70">{k.keyPrefix}</span>
                      <span className="text-zinc-600 mx-1.5">→</span>
                      <span>{k.lastError ?? "Unknown error"}</span>
                    </p>
                  ))}
                </div>
                <p className="text-[10px] text-zinc-600 mt-2">
                  Degraded keys are rate-limited or have consecutive errors. Use "Validate All" to re-check or toggle them off.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Keys table */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-sm">All Keys ({keys.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800">
                <TableHead className="text-zinc-500">Key</TableHead>
                <TableHead className="text-zinc-500">Provider</TableHead>
                <TableHead className="text-zinc-500">Model</TableHead>
                <TableHead className="text-zinc-500">Group</TableHead>
                <TableHead className="text-zinc-500">Tier</TableHead>
                <TableHead className="text-zinc-500">Status</TableHead>
                <TableHead className="text-zinc-500">Calls</TableHead>
                <TableHead className="text-zinc-500">Errors</TableHead>
                <TableHead className="text-zinc-500">Latency</TableHead>
                <TableHead className="text-zinc-500">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k: any) => (
                <TableRow key={k.id} className="border-zinc-800">
                  <TableCell className="font-mono text-xs">{k.keyPrefix}</TableCell>
                  <TableCell className="capitalize text-sm">{k.provider}</TableCell>
                  <TableCell className="text-xs text-zinc-400">{k.model.split("/").pop()}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${
                      k.group === "primary" ? "border-violet-500/40 text-violet-400" :
                      k.group === "germany" ? "border-amber-500/40 text-amber-400" :
                      k.group === "gemini" ? "border-blue-500/40 text-blue-400" :
                      "border-zinc-600 text-zinc-400"
                    }`}>
                      {k.group ?? "standard"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${k.tier === "premium" ? "border-teal-500/30 text-teal-400" : "border-zinc-600 text-zinc-400"}`}>
                      {k.tier}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Badge variant="outline" className={`text-xs cursor-default ${statusColor(k.status)}`}>
                            {k.status}
                          </Badge>
                        </span>
                      </TooltipTrigger>
                      {(k.status === "degraded" || k.status === "inactive") && k.lastError && (
                        <TooltipContent side="top" className="max-w-xs text-xs bg-zinc-900 border-zinc-700">
                          <p className="font-medium text-amber-400 mb-1">Reason:</p>
                          <p className="text-zinc-400">{k.lastError}</p>
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TableCell>
                  <TableCell className="text-sm">{k.totalCalls}</TableCell>
                  <TableCell className={`text-sm ${k.totalErrors > 0 ? "text-rose-400" : ""}`}>{k.totalErrors}</TableCell>
                  <TableCell className="text-sm text-zinc-400">{k.latencyMs != null ? `${k.latencyMs}ms` : "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleToggleStatus(k.id, k.status)}>
                        {k.status === "active" ? <ToggleRight className="w-4 h-4 text-emerald-400" /> : <ToggleLeft className="w-4 h-4 text-zinc-500" />}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-rose-400 hover:bg-rose-500/10" onClick={() => handleDelete(k.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Bulk Import Dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-800 max-w-lg">
          <DialogHeader>
            <DialogTitle>Bulk Import API Keys</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Paste keys one per line, space-separated, or mixed. Model names in the paste are automatically ignored.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-zinc-400">Provider</Label>
                <select value={bulkForm.provider} onChange={e => setBulkForm(f => ({ ...f, provider: e.target.value }))}
                  className="w-full mt-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm">
                  <option value="openrouter">OpenRouter</option>
                  <option value="gemini">Gemini</option>
                </select>
              </div>
              <div>
                <Label className="text-xs text-zinc-400">Tier</Label>
                <select value={bulkForm.tier} onChange={e => setBulkForm(f => ({ ...f, tier: e.target.value }))}
                  className="w-full mt-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm">
                  <option value="free">Free</option>
                  <option value="premium">Premium</option>
                </select>
              </div>
            </div>
            <div>
              <Label className="text-xs text-zinc-400">Model</Label>
              <select value={bulkForm.model} onChange={e => setBulkForm(f => ({ ...f, model: e.target.value }))}
                className="w-full mt-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm font-mono">
                <optgroup label="── Primary Tier ──">
                  {AVAILABLE_MODELS.filter(m => m.group === "primary").map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </optgroup>
                <optgroup label="── Standard Tier ──">
                  {AVAILABLE_MODELS.filter(m => m.group === "standard").map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </optgroup>
                <optgroup label="── Gemini Fallback ──">
                  {AVAILABLE_MODELS.filter(m => m.group === "gemini").map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div>
              <Label className="text-xs text-zinc-400">Keys (one per line or space-separated)</Label>
              <Textarea value={bulkForm.keys} onChange={e => setBulkForm(f => ({ ...f, keys: e.target.value }))}
                className="bg-zinc-800 border-zinc-700 mt-1 font-mono text-xs" rows={8} placeholder="sk-or-v1-abc123&#10;sk-or-v1-def456&#10;or paste space-separated keys..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-zinc-700" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button className="bg-teal-600 hover:bg-teal-500" onClick={handleBulkImport}>Import Keys</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Usage Report Card */}
      {usageReport && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-zinc-300 flex items-center gap-2">
              <Activity className="w-4 h-4 text-teal-400" />
              Key Pool Usage Report
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Summary row */}
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {[
                { label: "Total Keys", val: usageReport.summary.totalKeys },
                { label: "Active", val: usageReport.summary.activeKeys, color: "text-emerald-400" },
                { label: "Degraded", val: usageReport.summary.degradedKeys, color: "text-amber-400" },
                { label: "Unused", val: usageReport.summary.unusedKeys, color: "text-zinc-400" },
                { label: "Total Calls", val: usageReport.summary.totalCalls },
                { label: "Errors", val: usageReport.summary.totalErrors, color: usageReport.summary.totalErrors > 0 ? "text-rose-400" : "" },
              ].map(item => (
                <div key={item.label} className="bg-zinc-800/60 rounded-md p-2 text-center">
                  <p className={`text-lg font-bold ${item.color ?? ""}`}>{item.val}</p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">{item.label}</p>
                </div>
              ))}
            </div>
            {/* By group */}
            <div>
              <p className="text-xs text-zinc-500 mb-2 font-medium uppercase tracking-wider">By Priority Group</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {usageReport.byGroup.map((g: any) => (
                  <div key={g.group} className="bg-zinc-800/60 rounded-md p-2">
                    <Badge variant="outline" className={`text-[10px] mb-1 ${
                      g.group === "primary" ? "border-violet-500/40 text-violet-400" :
                      g.group === "germany" ? "border-amber-500/40 text-amber-400" :
                      g.group === "gemini" ? "border-blue-500/40 text-blue-400" :
                      "border-zinc-600 text-zinc-400"
                    }`}>{g.group}</Badge>
                    <p className="text-xs text-zinc-300">{g.active}/{g.total} active</p>
                    <p className="text-xs text-zinc-500">{g.totalCalls} calls</p>
                  </div>
                ))}
              </div>
            </div>
            {/* Recommendations */}
            {usageReport.recommendations?.length > 0 && (
              <div>
                <p className="text-xs text-zinc-500 mb-2 font-medium uppercase tracking-wider">Recommendations</p>
                <ul className="space-y-1">
                  {usageReport.recommendations.map((r: string, i: number) => (
                    <li key={i} className="text-xs text-zinc-400">{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
    </TooltipProvider>
  );
}

// ─── UNIFIED PROVIDERS & KEYS ────────────────────────────────────────────────
function UnifiedProvidersSection() {
  const [tab, setTab] = useState<"providers" | "keys">("providers");

  return (
    <div className="space-y-6">
      <SectionHeader title="AI Providers & Key Management" description="Configure providers, manage API keys, and monitor health" />

      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList className="bg-zinc-800 border-zinc-700">
          <TabsTrigger value="providers">
            <Cpu className="w-3.5 h-3.5 mr-1.5" />Providers
          </TabsTrigger>
          <TabsTrigger value="keys">
            <Key className="w-3.5 h-3.5 mr-1.5" />API Keys & Health
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "providers" && <ProvidersSection />}
      {tab === "keys" && <ApiKeysSection />}
    </div>
  );
}

// ─── ANALYTICS ──────────────────────────────────────────────────────────────
function AnalyticsSection() {
  const [dailySummary, setDailySummary] = useState<any[]>([]);
  const [enhancementTypes, setEnhancementTypes] = useState<any[]>([]);
  const [topUsers, setTopUsers] = useState<any[]>([]);
  const [monthlySummary, setMonthlySummary] = useState<any[]>([]);
  const [keyUsage, setKeyUsage] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState<"daily" | "monthly" | "types" | "users" | "keys">("daily");

  const token = localStorage.getItem("glimpse_token");
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const [dailyRes, typesRes, usersRes, monthlyRes, keyUsageRes] = await Promise.all([
          fetch("/api/admin/analytics/daily-summary?days=30", { headers }),
          fetch("/api/admin/analytics/enhancement-types", { headers }),
          fetch("/api/admin/analytics/top-users?limit=15", { headers }),
          fetch("/api/admin/analytics/monthly-summary", { headers }),
          fetch("/api/admin/analytics/key-usage?days=30", { headers }),
        ]);
        const [daily, types, users, monthly, keys] = await Promise.all([
          dailyRes.json(), typesRes.json(), usersRes.json(), monthlyRes.json(), keyUsageRes.json(),
        ]);
        setDailySummary(daily.daily ?? []);
        setEnhancementTypes(types.types ?? []);
        setTopUsers(users.users ?? []);
        setMonthlySummary(monthly.months ?? []);
        setKeyUsage(keys.usage ?? []);
      } catch {}
      setIsLoading(false);
    };
    load();
  }, []);

  const PIE_COLORS = ["#a855f7", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#6366f1", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-teal-500" /></div>;

  return (
    <div className="space-y-6">
      <SectionHeader title="Usage Analytics" description="Detailed insights into API usage, enhancements, and customer activity" />

      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList className="bg-zinc-800 border-zinc-700">
          <TabsTrigger value="daily">Daily</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="types">Enhancement Types</TabsTrigger>
          <TabsTrigger value="users">Top Users</TabsTrigger>
          <TabsTrigger value="keys">Key Usage</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "daily" && (
        <div className="space-y-6">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader><CardTitle className="text-base">Daily Enhancements (30 days)</CardTitle></CardHeader>
            <CardContent>
              {dailySummary.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={dailySummary} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gEnhance" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gUsers" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71717a" }} tickFormatter={d => d.slice(5)} />
                    <YAxis tick={{ fontSize: 10, fill: "#71717a" }} allowDecimals={false} />
                    <RechartsTooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }} />
                    <Legend wrapperStyle={{ fontSize: 12, color: "#a1a1aa" }} />
                    <Area type="monotone" dataKey="totalEnhancements" name="Enhancements" stroke="#a855f7" fill="url(#gEnhance)" strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="uniqueUsers" name="Active Users" stroke="#3b82f6" fill="url(#gUsers)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[280px] flex items-center justify-center text-zinc-600 text-sm">No data yet</div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader><CardTitle className="text-base">Average Processing Time (ms)</CardTitle></CardHeader>
            <CardContent>
              {dailySummary.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={dailySummary} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71717a" }} tickFormatter={d => d.slice(5)} />
                    <YAxis tick={{ fontSize: 10, fill: "#71717a" }} />
                    <RechartsTooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }} />
                    <Bar dataKey="avgProcessingMs" name="Avg ms" fill="#14b8a6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-zinc-600 text-sm">No data yet</div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "monthly" && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader><CardTitle className="text-base">Monthly Summary</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800">
                  <TableHead className="text-zinc-500">Month</TableHead>
                  <TableHead className="text-zinc-500">Total Jobs</TableHead>
                  <TableHead className="text-zinc-500">Completed</TableHead>
                  <TableHead className="text-zinc-500">Failed</TableHead>
                  <TableHead className="text-zinc-500">Avg Time (ms)</TableHead>
                  <TableHead className="text-zinc-500">Unique Users</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthlySummary.map((m: any) => (
                  <TableRow key={m.month} className="border-zinc-800">
                    <TableCell className="font-medium">{m.month}</TableCell>
                    <TableCell>{m.totalJobs}</TableCell>
                    <TableCell className="text-emerald-400">{m.completed}</TableCell>
                    <TableCell className={m.failed > 0 ? "text-rose-400" : ""}>{m.failed}</TableCell>
                    <TableCell className="text-zinc-400">{m.avgProcessingMs}</TableCell>
                    <TableCell>{m.uniqueUsers}</TableCell>
                  </TableRow>
                ))}
                {monthlySummary.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-zinc-600 py-8">No data yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {tab === "types" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader><CardTitle className="text-base">Enhancement Type Distribution</CardTitle></CardHeader>
            <CardContent>
              {enhancementTypes.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={enhancementTypes.map(t => ({ name: t.type, value: t.total }))} cx="50%" cy="50%"
                      outerRadius={100} label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                      labelLine={false} dataKey="value">
                      {enhancementTypes.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-zinc-600 text-sm">No data yet</div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader><CardTitle className="text-base">Enhancement Counts</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800">
                    <TableHead className="text-zinc-500">Type</TableHead>
                    <TableHead className="text-zinc-500 text-right">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enhancementTypes.map((t: any) => (
                    <TableRow key={t.type} className="border-zinc-800">
                      <TableCell className="font-medium capitalize">{t.type}</TableCell>
                      <TableCell className="text-right">{t.total}</TableCell>
                    </TableRow>
                  ))}
                  {enhancementTypes.length === 0 && (
                    <TableRow><TableCell colSpan={2} className="text-center text-zinc-600 py-8">No data yet</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "users" && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader><CardTitle className="text-base">Most Active Users</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800">
                  <TableHead className="text-zinc-500">User</TableHead>
                  <TableHead className="text-zinc-500">Plan</TableHead>
                  <TableHead className="text-zinc-500">Total Jobs</TableHead>
                  <TableHead className="text-zinc-500">Completed</TableHead>
                  <TableHead className="text-zinc-500">Credits</TableHead>
                  <TableHead className="text-zinc-500">Avg Time (ms)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topUsers.map((u: any) => (
                  <TableRow key={u.userId} className="border-zinc-800">
                    <TableCell>
                      <div>
                        <span className="font-medium">{u.user?.name ?? "Unknown"}</span>
                        <p className="text-xs text-zinc-500">{u.user?.email ?? `User #${u.userId}`}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${u.user?.planId ? "border-teal-500/30 text-teal-400" : "border-zinc-600 text-zinc-400"}`}>
                        {u.user?.planId ? "Paid" : "Free"}
                      </Badge>
                    </TableCell>
                    <TableCell>{u.totalJobs}</TableCell>
                    <TableCell className="text-emerald-400">{u.completedJobs}</TableCell>
                    <TableCell className="text-xs text-zinc-400">{u.user?.creditsUsed ?? 0}/{u.user?.creditsLimit ?? 0}</TableCell>
                    <TableCell className="text-zinc-400">{u.avgProcessingMs}</TableCell>
                  </TableRow>
                ))}
                {topUsers.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-zinc-600 py-8">No data yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {tab === "keys" && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader><CardTitle className="text-base">Per-Key Daily Usage (30 days)</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800">
                  <TableHead className="text-zinc-500">Date</TableHead>
                  <TableHead className="text-zinc-500">Key</TableHead>
                  <TableHead className="text-zinc-500">Provider</TableHead>
                  <TableHead className="text-zinc-500">Calls</TableHead>
                  <TableHead className="text-zinc-500">Errors</TableHead>
                  <TableHead className="text-zinc-500">Avg Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keyUsage.slice(0, 100).map((u: any, i: number) => (
                  <TableRow key={i} className="border-zinc-800">
                    <TableCell className="text-sm">{u.date}</TableCell>
                    <TableCell className="font-mono text-xs">{u.key?.keyPrefix ?? `Key #${u.apiKeyId}`}</TableCell>
                    <TableCell className="text-sm capitalize">{u.key?.provider ?? "—"}</TableCell>
                    <TableCell>{u.callCount}</TableCell>
                    <TableCell className={u.errorCount > 0 ? "text-rose-400" : ""}>{u.errorCount}</TableCell>
                    <TableCell className="text-zinc-400">{u.avgLatencyMs != null ? `${u.avgLatencyMs}ms` : "—"}</TableCell>
                  </TableRow>
                ))}
                {keyUsage.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-zinc-600 py-8">No usage data yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── AI INSIGHTS (localStorage analytics from editor) ──────────────────────
interface AiEvt {
  ts: number;
  action: "applied" | "dismissed" | "ignored";
  enhancement: string;
  filter?: string;
  imageType: string;
  confidence: number;
}

interface AiPoolKey {
  label: string;
  status: "healthy" | "daily_limit" | "circuit_open";
  provider: string;
  cooldownUntil?: string | null;
  lastUsed?: string | null;
  failCount?: number;
}
interface AiPoolStats {
  total: number;
  healthy: number;
  degraded: number;
  byProvider: Record<string, number>;
  keys: AiPoolKey[];
}

function AiInsightsSection() {
  const [events, setEvents] = useState<AiEvt[]>([]);
  const [pool, setPool] = useState<AiPoolStats | null>(null);
  const { toast } = useToast();
  useEffect(() => {
    try {
      const raw = localStorage.getItem("glimpse_ai_analytics");
      if (raw) setEvents(JSON.parse(raw));
    } catch {}

    const token = localStorage.getItem("glimpse_token");
    if (token) {
      fetch("/api/admin/ai-pool", { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setPool(d); })
        .catch(() => {});
    }
  }, []);

  const total = events.length;
  const applied = events.filter(e => e.action === "applied");
  const dismissed = events.filter(e => e.action === "dismissed");
  const ignored = events.filter(e => e.action === "ignored");
  const avgConf = total > 0 ? (events.reduce((s, e) => s + e.confidence, 0) / total) : 0;

  // Top enhancements
  const enhMap = new Map<string, number>();
  applied.forEach(e => enhMap.set(e.enhancement, (enhMap.get(e.enhancement) ?? 0) + 1));
  const topEnhancements = [...enhMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([name, count]) => ({ name, count }));

  // By image type
  const typeMap = new Map<string, { applied: number; dismissed: number; total: number }>();
  events.forEach(e => {
    const cur = typeMap.get(e.imageType) ?? { applied: 0, dismissed: 0, total: 0 };
    cur.total++;
    if (e.action === "applied") cur.applied++;
    if (e.action === "dismissed") cur.dismissed++;
    typeMap.set(e.imageType, cur);
  });
  const byType = [...typeMap.entries()].sort((a, b) => b[1].total - a[1].total)
    .map(([type, d]) => ({ type, ...d, rate: d.total > 0 ? Math.round((d.applied / d.total) * 100) : 0 }));

  // Enhancement classification: critical (high acceptance), optional (medium), skipped (low)
  const enhBreakdown = new Map<string, { applied: number; dismissed: number; ignored: number; total: number }>();
  events.forEach(e => {
    const cur = enhBreakdown.get(e.enhancement) ?? { applied: 0, dismissed: 0, ignored: 0, total: 0 };
    cur.total++;
    if (e.action === "applied") cur.applied++;
    if (e.action === "dismissed") cur.dismissed++;
    if (e.action === "ignored") cur.ignored++;
    enhBreakdown.set(e.enhancement, cur);
  });
  const classifiedEnhancements = [...enhBreakdown.entries()]
    .map(([name, d]) => {
      const rate = d.total > 0 ? Math.round((d.applied / d.total) * 100) : 0;
      const tier = rate >= 60 ? "critical" as const : rate >= 30 ? "optional" as const : "skipped" as const;
      return { name, ...d, rate, tier };
    })
    .sort((a, b) => b.total - a.total);

  // Pie data
  const PIE = [
    { name: "Applied", value: applied.length },
    { name: "Dismissed", value: dismissed.length },
    { name: "Ignored", value: ignored.length },
  ].filter(d => d.value > 0);
  const PIE_COLORS = ["#10b981", "#ef4444", "#6b7280"];

  const handleClearData = () => {
    if (!confirm("Clear all AI analytics data? This cannot be undone.")) return;
    localStorage.removeItem("glimpse_ai_analytics");
    setEvents([]);
    toast({ title: "AI analytics data cleared" });
  };

  return (
    <div className="space-y-6">
      <SectionHeader title="AI Insights" description="Analytics from AI suggestion interactions — refine future recommendations based on real user patterns"
        action={total > 0 ? (
          <Button size="sm" variant="outline" className="border-zinc-700 text-zinc-400" onClick={handleClearData}>
            <Trash2 className="w-3.5 h-3.5 mr-1.5" />Clear Data
          </Button>
        ) : undefined}
      />

      {/* AI Provider Pool Health */}
      {pool && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Cpu className="w-4 h-4 text-teal-400" />
                AI Provider Pool Health
              </CardTitle>
              <Badge variant="outline" className={pool.healthy > 0 ? "border-teal-500/40 text-teal-400" : "border-amber-500/40 text-amber-400"}>
                {pool.healthy > 0 ? `${pool.healthy}/${pool.total} Keys Healthy` : "Using Local Analysis"}
              </Badge>
            </div>
            <CardDescription className="text-xs text-zinc-500">
              Primary analysis: <span className="text-zinc-300 font-medium">Local Sharp Engine (75–92% confidence)</span>
              {pool.degraded > 0 && <span className="text-amber-400 ml-2">· {pool.degraded} key(s) rate-limited or circuit-open (resets ~24h)</span>}
            </CardDescription>
          </CardHeader>
          {pool.keys.length > 0 && (
            <CardContent>
              <div className="space-y-2">
                {pool.keys.map((k, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-zinc-800 last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${k.status === "healthy" ? "bg-emerald-400" : k.status === "daily_limit" ? "bg-amber-400" : "bg-red-400"}`} />
                      <span className="text-xs text-zinc-400 truncate">{k.provider} · {k.label}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {k.lastUsed && <span className="text-[10px] text-zinc-600">used {new Date(k.lastUsed).toLocaleTimeString()}</span>}
                      <Badge variant="outline" className={`text-[10px] py-0 ${k.status === "healthy" ? "border-emerald-500/40 text-emerald-400" : k.status === "daily_limit" ? "border-amber-500/40 text-amber-400" : "border-red-500/40 text-red-400"}`}>
                        {k.status === "healthy" ? "Healthy" : k.status === "daily_limit" ? "Daily Limit" : "Circuit Open"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Total Suggestions" value={total} icon={BrainCircuit} color="teal" />
        <StatCard title="Applied" value={applied.length} sub={total > 0 ? `${Math.round((applied.length / total) * 100)}%` : "—"} icon={Sparkles} color="teal" />
        <StatCard title="Dismissed" value={dismissed.length} sub={total > 0 ? `${Math.round((dismissed.length / total) * 100)}%` : "—"} icon={XCircle} color="red" />
        <StatCard title="Avg Confidence" value={`${Math.round(avgConf * 100)}%`} icon={Activity} />
      </div>

      {total === 0 ? (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="py-12 text-center">
            <BrainCircuit className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
            <p className="text-sm text-zinc-500">No AI suggestion events recorded yet.</p>
            <p className="text-xs text-zinc-600 mt-1">Events are tracked when users interact with AI suggestions in the editor.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Action distribution */}
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader><CardTitle className="text-base">Action Distribution</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={PIE} dataKey="value" cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={4}>
                    {PIE.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <RechartsTooltip contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 8 }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Top applied enhancements */}
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader><CardTitle className="text-base">Top Applied Enhancements</CardTitle></CardHeader>
            <CardContent>
              {topEnhancements.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={topEnhancements} layout="vertical" margin={{ left: 10 }}>
                    <XAxis type="number" stroke="#52525b" />
                    <YAxis type="category" dataKey="name" stroke="#71717a" width={110} tick={{ fontSize: 11 }} />
                    <RechartsTooltip contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 8 }} />
                    <Bar dataKey="count" fill="#a855f7" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-xs text-zinc-600 text-center py-6">No applied enhancements yet</p>}
            </CardContent>
          </Card>

          {/* Enhancement classification: Critical / Optional / Skipped */}
          <Card className="bg-zinc-900 border-zinc-800 lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Enhancement Classification</CardTitle>
              <CardDescription className="text-xs text-zinc-500">
                Based on user acceptance rates. Use this to refine which enhancements to prioritize in AI suggestions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {classifiedEnhancements.length > 0 ? (
                <div className="space-y-4">
                  {(["critical", "optional", "skipped"] as const).map(tier => {
                    const items = classifiedEnhancements.filter(e => e.tier === tier);
                    if (items.length === 0) return null;
                    const tierConfig = {
                      critical: { label: "Critical — Users love these", color: "text-teal-400", border: "border-teal-500/20", bg: "bg-teal-500/5", icon: <CheckCircle className="w-4 h-4 text-teal-400" /> },
                      optional: { label: "Optional — Mixed reception", color: "text-amber-400", border: "border-amber-500/20", bg: "bg-amber-500/5", icon: <AlertCircle className="w-4 h-4 text-amber-400" /> },
                      skipped: { label: "Often Skipped — Consider de-prioritizing", color: "text-red-400", border: "border-red-500/20", bg: "bg-red-500/5", icon: <XCircle className="w-4 h-4 text-red-400" /> },
                    }[tier];
                    return (
                      <div key={tier} className={`rounded-lg border ${tierConfig.border} ${tierConfig.bg} p-3`}>
                        <div className="flex items-center gap-2 mb-2">
                          {tierConfig.icon}
                          <span className={`text-xs font-medium ${tierConfig.color}`}>{tierConfig.label}</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {items.map(e => (
                            <div key={e.name} className="flex items-center gap-2 bg-zinc-900/80 rounded-lg px-3 py-1.5 border border-zinc-800">
                              <span className="text-xs font-medium text-zinc-300 capitalize">{e.name.replace(/_/g, " ")}</span>
                              <span className="text-[10px] text-zinc-500">{e.total} uses</span>
                              <Badge variant="outline" className={`text-[9px] ${e.rate >= 60 ? "border-teal-500/40 text-teal-400" : e.rate >= 30 ? "border-amber-500/40 text-amber-400" : "border-red-500/40 text-red-400"}`}>
                                {e.rate}% accepted
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : <p className="text-xs text-zinc-600 text-center py-6">No enhancement data yet</p>}
            </CardContent>
          </Card>

          {/* By image type */}
          <Card className="bg-zinc-900 border-zinc-800 lg:col-span-2">
            <CardHeader><CardTitle className="text-base">Acceptance by Image Type</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800">
                    <TableHead className="text-zinc-500">Image Type</TableHead>
                    <TableHead className="text-zinc-500 text-right">Total</TableHead>
                    <TableHead className="text-zinc-500 text-right">Applied</TableHead>
                    <TableHead className="text-zinc-500 text-right">Dismissed</TableHead>
                    <TableHead className="text-zinc-500 text-right">Acceptance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byType.map(r => (
                    <TableRow key={r.type} className="border-zinc-800">
                      <TableCell className="capitalize font-medium text-zinc-300">{r.type}</TableCell>
                      <TableCell className="text-right text-zinc-400">{r.total}</TableCell>
                      <TableCell className="text-right text-teal-400">{r.applied}</TableCell>
                      <TableCell className="text-right text-red-400">{r.dismissed}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className={r.rate >= 60 ? "border-teal-500/40 text-teal-400" : r.rate >= 30 ? "border-amber-500/40 text-amber-400" : "border-red-500/40 text-red-400"}>
                          {r.rate}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── ADMIN SHELL ─────────────────────────────────────────────────────────────
const navItems: { id: AdminSection; label: string; icon: React.ElementType; badge?: string }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "users", label: "Users", icon: Users },
  { id: "jobs", label: "Jobs", icon: Layers },
  { id: "payments", label: "Payments", icon: CreditCard },
  { id: "plans", label: "Plans", icon: BadgeDollarSign },
  { id: "providers", label: "AI Providers & Keys", icon: Cpu },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "aiinsights", label: "AI Insights", icon: BrainCircuit },
];

export default function Admin() {
  const [section, setSection] = useState<AdminSection>("overview");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  const AdminNav = ({ onNavClick }: { onNavClick?: () => void }) => (
    <>
      <div className="p-5 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-teal-400" />
          <span className="font-semibold text-sm">Admin Console</span>
        </div>
        <p className="text-xs text-zinc-500 mt-1 truncate">{user?.email}</p>
      </div>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => { setSection(item.id); onNavClick?.(); }}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              section === item.id
                ? "bg-teal-600/20 text-teal-300 font-medium"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            <item.icon className="w-4 h-4 shrink-0" />
            {item.label}
          </button>
        ))}
      </nav>
      <div className="p-3 border-t border-zinc-800 space-y-1">
        <button onClick={() => { navigate("/dashboard"); onNavClick?.(); }} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors">
          <LayoutDashboard className="w-4 h-4" /> Back to Dashboard
        </button>
        <button onClick={handleLogout} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-rose-400 hover:bg-rose-500/10 transition-colors">
          <LogOut className="w-4 h-4" /> Sign Out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-black flex">
      {/* Desktop sidebar (md+) */}
      <aside className="w-60 shrink-0 border-r border-zinc-800 bg-zinc-950 flex-col hidden md:flex">
        <AdminNav />
      </aside>

      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile sliding drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-zinc-950 border-r border-zinc-800 flex flex-col transition-transform duration-300 ease-in-out md:hidden ${drawerOpen ? "translate-x-0" : "-translate-x-full"}`}
        aria-label="Admin navigation"
      >
        <button
          onClick={() => setDrawerOpen(false)}
          className="absolute top-4 right-4 text-zinc-400 hover:text-white p-1 rounded hover:bg-zinc-800 transition-colors"
          aria-label="Close menu"
        >
          <span className="text-lg leading-none">×</span>
        </button>
        <AdminNav onNavClick={() => setDrawerOpen(false)} />
      </aside>

      {/* Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-14 border-b border-zinc-800 px-4 sm:px-6 flex items-center justify-between bg-zinc-950/50 backdrop-blur shrink-0">
          <div className="flex items-center gap-3">
            {/* Mobile hamburger */}
            <button
              onClick={() => setDrawerOpen(true)}
              className="md:hidden text-zinc-400 hover:text-white p-1 rounded hover:bg-zinc-800 transition-colors"
              aria-label="Open admin navigation"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span className="text-sm text-zinc-400">
              {navItems.find(n => n.id === section)?.label}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-zinc-500">Live</span>
          </div>
        </header>

        {/* Page content */}
        <ScrollArea className="flex-1">
          <div className="p-4 sm:p-6 lg:p-8 max-w-[1200px] mx-auto">
            {section === "overview" && <Overview />}
            {section === "users" && <UsersSection />}
            {section === "jobs" && <JobsSection />}
            {section === "payments" && <PaymentsSection />}
            {section === "plans" && <PlansSection />}
            {section === "providers" && <UnifiedProvidersSection />}
            {section === "analytics" && <AnalyticsSection />}
            {section === "aiinsights" && <AiInsightsSection />}
          </div>
        </ScrollArea>
      </div>
      <AiChatWidget context="admin" />
    </div>
  );
}
