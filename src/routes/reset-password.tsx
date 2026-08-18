import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { SperoLogo } from "@/components/SperoLogo";
import { PasswordStrengthMeter } from "@/components/PasswordStrengthMeter";
import { authErrorMessage } from "@/lib/auth-errors";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Reset password — SPERO Internal MIS" }],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const nav = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return toast.error("Password must be at least 6 characters");
    if (password !== confirm) return toast.error("Passwords do not match");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      return toast.error(
        error.message.includes("session")
          ? "This reset link is invalid or has expired. Request a new one from the sign-in page."
          : authErrorMessage(error.message),
      );
    }
    toast.success("Password updated — you can sign in now");
    await supabase.auth.signOut();
    nav({ to: "/auth" });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="card-dense w-full max-w-md border-none p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600/10">
            <SperoLogo size={30} />
          </div>
          <div>
            <span className="block font-display text-base font-semibold leading-tight">
              SPERO Internal MIS
            </span>
            <span className="block text-xs text-muted-foreground">Leave & Absence</span>
          </div>
        </div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Set a new password</h1>
        <p className="mb-6 mt-1 text-sm text-muted-foreground">
          Choose a new password for your account.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              aria-describedby="password-strength"
            />
            <PasswordStrengthMeter password={password} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Confirm password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={6}
            />
          </div>
          <Button type="submit" disabled={busy} className="w-full" size="lg">
            {busy ? "Updating…" : "Update password"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
