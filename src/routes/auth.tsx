import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Trees } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Absentia" },
      { name: "description", content: "Sign in to Absentia to manage leave and absence." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { session, loading } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  if (!loading && session) return <Navigate to="/dashboard" />;

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Welcome back");
    nav({ to: "/dashboard" });
  };

  const signUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: name || email },
      },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Account created — signing you in");
    const { error: e2 } = await supabase.auth.signInWithPassword({ email, password });
    if (!e2) nav({ to: "/dashboard" });
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-sidebar text-sidebar-foreground p-10">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <Trees className="h-5 w-5" />
          </div>
          <span className="text-lg font-semibold">Absentia</span>
        </div>
        <div className="space-y-4 max-w-md">
          <h1 className="text-4xl font-semibold leading-tight">Leave and absence, without the spreadsheet.</h1>
          <p className="text-sidebar-foreground/70">
            A month-by-month calendar for the whole organisation, live balances, approvals and audit — all in one place.
          </p>
        </div>
        <div className="text-xs text-sidebar-foreground/50">British English throughout — organisation, colour, annual leave.</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md p-6">
          <h2 className="text-2xl font-semibold mb-1">Welcome</h2>
          <p className="text-sm text-muted-foreground mb-6">Sign in to access the leave management console.</p>
          <Tabs defaultValue="signin">
            <TabsList className="grid grid-cols-2 mb-4">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
              <form onSubmit={signIn} className="space-y-4">
                <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
                <div><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
                <Button type="submit" disabled={busy} className="w-full">{busy ? "Signing in…" : "Sign in"}</Button>
              </form>
            </TabsContent>
            <TabsContent value="signup">
              <form onSubmit={signUp} className="space-y-4">
                <div><Label>Full name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
                <div><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} /></div>
                <Button type="submit" disabled={busy} className="w-full">{busy ? "Creating account…" : "Create account"}</Button>
                <p className="text-xs text-muted-foreground">New accounts are given admin access so you can explore the demo data.</p>
              </form>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}