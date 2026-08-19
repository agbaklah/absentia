import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { SperoLogo } from "@/components/SperoLogo";
import { toast } from "sonner";
import { passwordStrength } from "@/lib/password-strength";
import { PasswordStrengthMeter } from "@/components/PasswordStrengthMeter";
import { ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/change-password")({
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  const { session, profile, loading } = useAuth();
  const nav = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const strength = passwordStrength(password);
  const valid = strength.score === 4 && password === confirm && password.length > 0;

  if (loading) return null;
  if (!session) return <Navigate to="/auth" />;

  // If the user doesn't need to change their password, go to dashboard
  if (!profile) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return toast.error(error.message);

    // Clear the force_password_change flag
    const { error: updateErr } = await supabase
      .from("profiles")
      .update({ force_password_change: false })
      .eq("id", profile.id);
    if (updateErr) {
      console.warn("[change-password] Could not clear flag:", updateErr.message);
    }

    toast.success("Password updated — welcome aboard!");
    nav({ to: "/dashboard" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600/10">
            <SperoLogo size={28} />
          </div>
          <div>
            <span className="block text-sm font-semibold">SPERO Internal MIS</span>
            <span className="block text-xs text-muted-foreground">Force password change</span>
          </div>
        </div>

        <div className="mb-5 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">You must change your temporary password</p>
            <p className="mt-0.5 text-xs opacity-80">
              Your admin set an initial password for your account. Please choose a new,
              strong password before continuing.
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoFocus
              aria-describedby="password-strength"
            />
            <PasswordStrengthMeter password={password} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat the new password"
            />
          </div>
          <Button type="submit" disabled={!valid || busy} className="w-full" size="lg">
            {busy ? "Updating…" : "Set new password & continue"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
