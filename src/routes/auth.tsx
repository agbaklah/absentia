import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { SperoLogo } from "@/components/SperoLogo";
import { CalendarDays, CheckCircle2, ShieldCheck, TrendingUp } from "lucide-react";
import { isWorkEmail, WORK_EMAIL_DOMAIN } from "@/lib/work-email";
import { authErrorMessage } from "@/lib/auth-errors";
import { PasswordStrengthMeter } from "@/components/PasswordStrengthMeter";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — SPERO Internal MIS" },
      {
        name: "description",
        content: "Sign in to SPERO Internal MIS to manage leave and absence.",
      },
    ],
  }),
  component: AuthPage,
});

const FEATURES = [
  {
    icon: CalendarDays,
    title: "One calendar for everyone",
    text: "See who's off, when, across the whole organisation.",
  },
  {
    icon: TrendingUp,
    title: "Live balances",
    text: "Vacation, TOIL and sickness tracked automatically.",
  },
  {
    icon: ShieldCheck,
    title: "Approvals with audit trail",
    text: "Every decision recorded — who approved, when, and why.",
  },
];

function AuthPage() {
  const { session, loading } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);

  // Departments are the org's teams; readable by anon so the sign-up page can list them.
  useEffect(() => {
    supabase
      .from("teams")
      .select("id, name")
      .order("name")
      .then(({ data }) => {
        if (data) setTeams(data as { id: string; name: string }[]);
      });
  }, []);

  if (!loading && session) return <Navigate to="/dashboard" />;

  const requireWorkEmail = (raw: string): string | null => {
    const em = raw.trim();
    if (!em) return "Enter your work email.";
    if (!isWorkEmail(em)) return `Only @${WORK_EMAIL_DOMAIN} work emails are allowed.`;
    return null;
  };

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const em = requireWorkEmail(email);
    if (em) return toast.error(em);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return toast.error(authErrorMessage(error.message));
    toast.success("Welcome back");
    nav({ to: "/dashboard" });
  };

  const resetPassword = async () => {
    if (!email) return toast.error("Enter your email above first, then tap “Forgot password”.");
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) return toast.error(authErrorMessage(error.message));
    toast.success("If that email has an account, a reset link is on its way.");
  };

  const signUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const em = requireWorkEmail(email);
    if (em) return toast.error(em);
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          full_name: name.trim() || email.trim(),
          team_id: department && department !== "none" ? department : undefined,
        },
      },
    });
    setBusy(false);
    if (error) return toast.error(authErrorMessage(error.message));
    if (data.session) {
      toast.success("Account created — signing you in");
      nav({ to: "/dashboard" });
      return;
    }
    toast.success("Account created — check your email to confirm it before signing in.");
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-sidebar text-white lg:flex lg:flex-col lg:justify-between">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url(/spero-auth-bg.jpg)" }}
          aria-hidden
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/60 to-black/40"
          aria-hidden
        />

        <div className="relative z-10 flex items-center gap-2.5 p-10">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white shadow-lg">
            <SperoLogo size={30} />
          </div>
          <div>
            <span className="block text-base font-semibold leading-tight">SPERO Internal MIS</span>
            <span className="block text-xs text-white/60">Energy Resources Ltd</span>
          </div>
        </div>

        <div className="relative z-10 max-w-md space-y-8 p-10">
          <div className="space-y-3">
            <h1 className="font-display text-4xl font-semibold leading-tight drop-shadow-sm">
              Leave and absence, without the spreadsheet.
            </h1>
            <p className="text-white/75">
              A month-by-month calendar for the whole organisation, live balances, approvals and
              audit — all in one place.
            </p>
          </div>
          <ul className="space-y-4">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/20">
                  <f.icon className="h-4 w-4 text-amber-300" />
                </span>
                <div>
                  <div className="text-sm font-medium">{f.title}</div>
                  <div className="text-xs text-white/60">{f.text}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="relative z-10 flex items-center gap-2 p-10 text-xs text-white/50">
          <CheckCircle2 className="h-3.5 w-3.5" />
          British English throughout — organisation, colour, annual leave.
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6">
        <Card className="card-dense w-full max-w-md border-none p-8 shadow-xl">
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600/10">
              <SperoLogo size={26} />
            </div>
            <span className="font-display text-base font-semibold">SPERO Internal MIS</span>
          </div>
          <h2 className="font-display text-2xl font-semibold tracking-tight">Welcome</h2>
          <p className="mb-6 mt-1 text-sm text-muted-foreground">
            Sign in to access the leave management console.
          </p>
          <Tabs defaultValue="signin">
            <TabsList className="mb-5 grid w-full grid-cols-2 rounded-lg bg-muted p-1">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
              <form onSubmit={signIn} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="you@verve-energyresources.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <button
                      type="button"
                      onClick={resetPassword}
                      className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                  />
                </div>
                <Button type="submit" disabled={busy} className="w-full" size="lg">
                  {busy ? "Signing in…" : "Sign in"}
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="signup">
              <form onSubmit={signUp} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Full name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    placeholder="Jane Smith"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signup-email">Work email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="you@verve-energyresources.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signup-department">Department</Label>
                  <Select value={department} onValueChange={setDepartment}>
                    <SelectTrigger id="signup-department" className="w-full">
                      <SelectValue placeholder="Choose your department" />
                    </SelectTrigger>
                    <SelectContent>
                      {teams.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                      <SelectItem value="none">Not listed / Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    placeholder="At least 6 characters"
                    aria-describedby="password-strength"
                  />
                  <PasswordStrengthMeter password={password} />
                </div>
                <Button type="submit" disabled={busy} className="w-full" size="lg">
                  {busy ? "Creating account…" : "Create account"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Only @{WORK_EMAIL_DOMAIN} work emails can create an account. If your workplace
                  pre-registered your email, you’ll join with the role they assigned. Otherwise
                  you’ll start as an employee.
                </p>
              </form>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}
