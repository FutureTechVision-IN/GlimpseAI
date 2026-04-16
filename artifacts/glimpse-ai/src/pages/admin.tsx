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
  FileWarning, Layers
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";

type AdminSection =
  | "overview"
  | "users"
  | "jobs"
  | "payments"
  | "plans"
  | "providers";

function StatCard({
  title, value, sub, icon: Icon, trend, color = "purple"
}: {
  title: string; value: string | number; sub?: string;
  icon: React.ElementType; trend?: number; color?: string;
}) {
  const colors: Record<string, string> = {
    purple: "text-purple-400", emerald: "text-emerald-400",
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
    return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-purple-500" /></div>;
  }

  return (
    <div className="space-y-8">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Users" value={stats?.totalUsers.toLocaleString() ?? "—"} sub={`${stats?.freeUsers ?? 0} free · ${stats?.paidUsers ?? 0} paid`} icon={Users} color="purple" />
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
                  <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }} labelStyle={{ color: "#a1a1aa" }} itemStyle={{ color: "#e4e4e7" }} />
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
                    <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }} />
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
                  <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }} labelStyle={{ color: "#a1a1aa" }} itemStyle={{ color: "#e4e4e7" }} />
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
                    <span className="text-purple-400 font-semibold">{stats?.conversionRate ? `${(stats.conversionRate * 100).toFixed(1)}%` : "0%"}</span>
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
                    <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-sm font-bold text-purple-400">{u.name[0]}</div>
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
  const [creditDialog, setCreditDialog] = useState<{ userId: number; name: string } | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
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
    if (isNaN(credits) || credits < 0) { toast({ title: "Enter a valid credit limit", variant: "destructive" }); return; }
    await creditMutation.mutateAsync({ id: creditDialog.userId, data: { credits } });
    toast({ title: `Credits updated for ${creditDialog.name}` });
    qc.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
    setCreditDialog(null);
    setCreditAmount("");
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
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-purple-500" /></div>
      ) : (
        <Card className="bg-zinc-900 border-zinc-800">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-500">User</TableHead>
                <TableHead className="text-zinc-500">Role</TableHead>
                <TableHead className="text-zinc-500">Plan</TableHead>
                <TableHead className="text-zinc-500">Credits</TableHead>
                <TableHead className="text-zinc-500">Status</TableHead>
                <TableHead className="text-zinc-500">Joined</TableHead>
                <TableHead className="text-zinc-500 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.users.map(user => (
                <TableRow key={user.id} className="border-zinc-800 hover:bg-zinc-800/40">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-sm font-bold text-purple-400">{user.name[0]}</div>
                      <div>
                        <div className="text-sm font-medium">{user.name}</div>
                        <div className="text-xs text-zinc-500">{user.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={user.role === "admin" ? "border-purple-500/40 text-purple-400 bg-purple-500/10" : "border-zinc-700 text-zinc-400"}>
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
                  <TableCell>
                    {user.isSuspended
                      ? <span className="text-xs text-rose-400 flex items-center gap-1"><XCircle className="w-3 h-3" /> Suspended</span>
                      : <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Active</span>}
                  </TableCell>
                  <TableCell className="text-xs text-zinc-500">{new Date(user.createdAt).toLocaleDateString("en-IN")}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" variant="ghost" className="text-zinc-400 hover:text-blue-400 hover:bg-blue-500/10 text-xs h-7 px-2"
                        onClick={() => { setCreditDialog({ userId: user.id, name: user.name }); setCreditAmount(String(user.creditsLimit)); }}>
                        <Key className="w-3 h-3 mr-1" /> Credits
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
                <TableRow><TableCell colSpan={7} className="text-center py-12 text-zinc-500">No users found</TableCell></TableRow>
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

      <Dialog open={!!creditDialog} onOpenChange={open => !open && setCreditDialog(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-800">
          <DialogHeader>
            <DialogTitle>Adjust Credit Limit</DialogTitle>
            <DialogDescription className="text-zinc-400">Set the monthly credit limit for {creditDialog?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Credit limit (per month)</Label>
            <Input type="number" value={creditAmount} onChange={e => setCreditAmount(e.target.value)} className="bg-zinc-800 border-zinc-700" placeholder="e.g. 50" />
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-zinc-700" onClick={() => setCreditDialog(null)}>Cancel</Button>
            <Button className="bg-purple-600 hover:bg-purple-500" onClick={handleCredits} disabled={creditMutation.isPending}>
              {creditMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
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
            className={`capitalize h-7 px-3 text-xs rounded-full ${statusFilter === s ? "bg-purple-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
            onClick={() => { setStatusFilter(s); setPage(1); }}>
            {s === "all" ? "All Jobs" : s}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-purple-500" /></div>
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
        <StatCard title="Success Rate" value={data ? `${data.payments.length > 0 ? Math.round(data.payments.filter(p => p.status === "success").length / data.payments.length * 100) : 0}%` : "—"} icon={TrendingUp} color="purple" />
      </div>
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-purple-500" /></div>
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
        action={<Button size="sm" className="bg-purple-600 hover:bg-purple-500" onClick={() => { resetForm(); setShowCreate(true); }}><Plus className="w-4 h-4 mr-1" /> New Plan</Button>} />

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-purple-500" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {plans?.map(plan => (
            <Card key={plan.id} className={`bg-zinc-900 border-zinc-800 relative ${plan.isPopular ? "ring-1 ring-purple-500/50" : ""}`}>
              {plan.isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-purple-600 text-white text-xs px-3">Most Popular</Badge>
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
                      <CheckCircle className="w-3.5 h-3.5 text-purple-400 mt-0.5 shrink-0" />{f}
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
            <Button className="bg-purple-600 hover:bg-purple-500" onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
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
        action={<Button size="sm" className="bg-purple-600 hover:bg-purple-500" onClick={() => setShowCreate(true)}><Plus className="w-4 h-4 mr-1" /> Add Provider</Button>} />

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-purple-500" /></div>
      ) : (
        <div className="space-y-4">
          {providers?.length === 0 && (
            <Card className="bg-zinc-900 border-zinc-800">
              <CardContent className="flex flex-col items-center justify-center py-16 text-zinc-500 space-y-3">
                <Cpu className="w-10 h-10 opacity-30" />
                <p>No AI providers configured</p>
                <Button size="sm" className="bg-purple-600 hover:bg-purple-500" onClick={() => setShowCreate(true)}>Add your first provider</Button>
              </CardContent>
            </Card>
          )}
          {providers?.map(provider => (
            <Card key={provider.id} className={`bg-zinc-900 border-zinc-800 ${!provider.isEnabled ? "opacity-60" : ""}`}>
              <CardContent className="pt-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center">
                      <Cpu className="w-5 h-5 text-purple-400" />
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
            <Button className="bg-purple-600 hover:bg-purple-500" onClick={handleCreate} disabled={createMutation.isPending}>
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
            <Button className="bg-purple-600 hover:bg-purple-500" onClick={handleRotateKey} disabled={!newKey.trim() || updateMutation.isPending}>
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Rotate Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  { id: "providers", label: "AI Providers", icon: Cpu },
];

export default function Admin() {
  const [section, setSection] = useState<AdminSection>("overview");
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-black flex">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 border-r border-zinc-800 bg-zinc-950 flex flex-col">
        <div className="p-5 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-purple-400" />
            <span className="font-semibold text-sm">Admin Console</span>
          </div>
          <p className="text-xs text-zinc-500 mt-1 truncate">{user?.email}</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                section === item.id
                  ? "bg-purple-600/20 text-purple-300 font-medium"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-zinc-800 space-y-1">
          <button onClick={() => navigate("/")} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors">
            <LayoutDashboard className="w-4 h-4" /> Back to App
          </button>
          <button onClick={handleLogout} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-rose-400 hover:bg-rose-500/10 transition-colors">
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-14 border-b border-zinc-800 px-6 flex items-center justify-between bg-zinc-950/50 backdrop-blur shrink-0">
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            {navItems.find(n => n.id === section)?.label}
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-zinc-500">Live</span>
          </div>
        </header>

        {/* Page content */}
        <ScrollArea className="flex-1">
          <div className="p-8 max-w-[1200px] mx-auto">
            {section === "overview" && <Overview />}
            {section === "users" && <UsersSection />}
            {section === "jobs" && <JobsSection />}
            {section === "payments" && <PaymentsSection />}
            {section === "plans" && <PlansSection />}
            {section === "providers" && <ProvidersSection />}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
