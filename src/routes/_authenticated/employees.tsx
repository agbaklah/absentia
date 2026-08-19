import { createFileRoute, Navigate, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useEmployees, useTeams, useEntries, type EmployeeRow } from "@/lib/data";
import { LEAVE_MAP, fmtISO } from "@/lib/leave";
import { toRequests } from "@/lib/requests-util";
import { useAuth } from "@/lib/auth-context";
import { isWorkEmail, WORK_EMAIL_DOMAIN } from "@/lib/work-email";
import { authErrorMessage } from "@/lib/auth-errors";
import { rotateUserPassword } from "@/lib/rotate-password";
import { deleteEmployee } from "@/lib/delete-employee";
import { createEmployeeAccount } from "@/lib/create-employee-account";
import { passwordStrength } from "@/lib/password-strength";
import { PasswordStrengthMeter } from "@/components/PasswordStrengthMeter";
import { PageHeader } from "@/components/PageHeader";
import { InitialsAvatar } from "@/components/InitialsAvatar";
import { EmployeeDetailDrawer } from "@/components/EmployeeDetailDrawer";
import { Eye, Search, UserPlus, Trash2, Copy, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/employees")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : "",
    view: typeof search.view === "string" ? search.view : "",
  }),
  component: EmployeesPage,
});

type Role = "employee" | "manager" | "admin" | "super_admin";

const roleTone: Record<Role, "secondary" | "outline" | "default"> = {
  employee: "secondary",
  manager: "outline",
  admin: "default",
  super_admin: "default",
};

const roleLabel: Record<Role, string> = {
  employee: "Employee",
  manager: "Manager",
  admin: "Admin",
  super_admin: "Super Admin",
};

// Only a super admin can manage admin/super_admin accounts.
const canManageRole = (isSuperAdmin: boolean, role: string) =>
  isSuperAdmin || (role !== "admin" && role !== "super_admin");

function EmployeesPage() {
  const { loading, isManagement, isAdmin, isSuperAdmin } = useAuth();
  const employees = useEmployees();
  const teams = useTeams();
  const entries = useEntries(new Date().getFullYear());
  const qc = useQueryClient();
  const nav = useNavigate();
  const { q: searchQ, view } = useSearch({ from: "/_authenticated/employees" });
  const [q, setQ] = useState(searchQ ?? "");

  // Keep the visible search box in sync when the URL q changes (e.g. the
  // command palette navigates here with a pre-filled search).
  useEffect(() => {
    setQ(searchQ ?? "");
  }, [searchQ]);
  const [sort, setSort] = useState<"name" | "leave">("name");
  const [resetTarget, setResetTarget] = useState<EmployeeRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EmployeeRow | null>(null);

  // Per-employee leave activity this year: number of requests + total days.
  const leaveByEmp = useMemo(() => {
    const map = new Map<string, { requests: number; days: number }>();
    for (const r of toRequests(entries.data ?? [])) {
      const cur = map.get(r.empId) ?? { requests: 0, days: 0 };
      cur.requests += 1;
      cur.days += r.items.reduce(
        (s, e) => s + (LEAVE_MAP[e.leave_code as keyof typeof LEAVE_MAP]?.days ?? 1),
        0,
      );
      map.set(r.empId, cur);
    }
    return map;
  }, [entries.data]);

  if (loading) return null;
  if (!isManagement) return <Navigate to="/dashboard" />;

  const selectedEmployee = (employees.data ?? []).find((e) => e.id === view) ?? null;

  // Preserve the URL's q (which the command palette sets) when closing.
  const closeDrawer = () => {
    nav({ to: "/employees", search: { q: searchQ, view: "" } });
  };

  const openEmployee = (id: string) => {
    nav({ to: "/employees", search: { q: searchQ, view: id } });
  };

  const filtered = (employees.data ?? []).filter((e) =>
    (e.full_name + " " + e.email).toLowerCase().includes(q.toLowerCase()),
  );
  const sorted = [...filtered].sort((a, b) => {
    if (sort === "leave") {
      return (leaveByEmp.get(b.id)?.requests ?? 0) - (leaveByEmp.get(a.id)?.requests ?? 0);
    }
    return a.full_name.localeCompare(b.full_name);
  });

  const softDelete = async (id: string) => {
    const { error } = await supabase.from("profiles").update({ active: false }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Employee archived");
    void qc.invalidateQueries({ queryKey: ["employees"] });
  };

  const changeRole = async (id: string, role: Role) => {
    const { error } = await supabase.from("profiles").update({ role }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`Role updated to ${role}`);
    void qc.invalidateQueries({ queryKey: ["employees"] });
  };

  const changeTeam = async (id: string, teamId: string) => {
    const { error } = await supabase
      .from("profiles")
      .update({ team_id: teamId || null })
      .eq("id", id);
    if (error) return toast.error(error.message);
    const teamName = (teams.data ?? []).find((t) => t.id === teamId)?.name ?? "Unassigned";
    toast.success(`Moved to ${teamName}`);
    void qc.invalidateQueries({ queryKey: ["employees"] });
  };

  const sendPasswordReset = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) return toast.error(authErrorMessage(error.message));
    toast.success(`Password reset link sent to ${email}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Employees" description="Manage staff, roles and team assignments.">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-64 pl-8"
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as "name" | "leave")}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Sort: Name (A–Z)</SelectItem>
            <SelectItem value="leave">Sort: Most leave</SelectItem>
          </SelectContent>
        </Select>
        <NewEmployeeDialog />
      </PageHeader>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="px-3 py-2.5">Employee</th>
                <th className="px-3 py-2.5">Team</th>
                <th className="px-3 py-2.5">Role</th>
                <th className="px-3 py-2.5">Leave (yr)</th>
                <th className="px-3 py-2.5">Started</th>
                <th className="px-3 py-2.5 w-28"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => {
                const team = (teams.data ?? []).find((t) => t.id === e.team_id);
                const leave = leaveByEmp.get(e.id) ?? { requests: 0, days: 0 };
                return (
                  <tr
                    key={e.id}
                    className={`border-t transition-colors hover:bg-muted/30 ${view === e.id ? "bg-muted/40" : ""}`}
                  >
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => openEmployee(e.id)}
                        className="group flex cursor-pointer items-center gap-2.5 text-left"
                        title="View employee details"
                      >
                        <InitialsAvatar name={e.full_name} />
                        <div className="min-w-0">
                          <div className="truncate font-medium group-hover:text-primary group-hover:underline group-hover:underline-offset-2">
                            {e.full_name}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">{e.email}</div>
                        </div>
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      {isAdmin ? (
                        <Select
                          value={e.team_id ?? ""}
                          onValueChange={(v) => changeTeam(e.id, v)}
                        >
                          <SelectTrigger className="h-8 w-40">
                            <SelectValue placeholder="Unassigned" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">Unassigned</SelectItem>
                            {(teams.data ?? []).map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                {t.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span>{team?.name ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {isAdmin && canManageRole(isSuperAdmin, e.role) ? (
                        <Select value={e.role} onValueChange={(v) => changeRole(e.id, v as Role)}>
                          <SelectTrigger className="h-8 w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="employee">Employee</SelectItem>
                            <SelectItem value="manager">Manager</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                            {isSuperAdmin && (
                              <SelectItem value="super_admin">Super Admin</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant={roleTone[e.role as Role]}>
                          {roleLabel[e.role as Role]}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="tabular font-medium">{leave.requests}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        req · {leave.days} day{leave.days !== 1 ? "s" : ""}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{e.employment_start_date}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" onClick={() => openEmployee(e.id)}>
                        <Eye className="h-3.5 w-3.5" />
                        View
                      </Button>
                      {isAdmin && e.auth_user_id && canManageRole(isSuperAdmin, e.role) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            isSuperAdmin ? setResetTarget(e) : sendPasswordReset(e.email)
                          }
                        >
                          Reset
                        </Button>
                      )}
                      {canManageRole(isSuperAdmin, e.role) ? (
                        <Button variant="ghost" size="sm" onClick={() => softDelete(e.id)}>
                          Archive
                        </Button>
                      ) : null}
                      {isSuperAdmin && e.role !== "super_admin" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(e)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <EmployeeDetailDrawer employee={selectedEmployee} onClose={closeDrawer} />
      <ResetPasswordDialog employee={resetTarget} onClose={() => setResetTarget(null)} />
      <DeleteEmployeeDialog employee={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hard-delete dialog (super admin only)
// ---------------------------------------------------------------------------
function DeleteEmployeeDialog({
  employee,
  onClose,
}: {
  employee: EmployeeRow | null;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState("");
  const qc = useQueryClient();

  const submit = async () => {
    if (!employee) return;
    setBusy(true);
    try {
      const result = await deleteEmployee({ data: { profileId: employee.id } });
      if (result?.error) {
        toast.error(result.error);
      } else {
        toast.success(`${employee.full_name} has been permanently deleted`);
        setConfirm("");
        onClose();
        void qc.invalidateQueries({ queryKey: ["employees"] });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete employee");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={employee !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-destructive">
            Permanently delete {employee?.full_name}?
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            This will <strong>permanently remove</strong> the employee's profile, login account,
            and all leave records. This action cannot be undone.
          </p>
          <p className="text-muted-foreground">
            Type <strong>DELETE</strong> to confirm.
          </p>
          <Input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Type DELETE"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={busy || confirm !== "DELETE"}
          >
            {busy ? "Deleting…" : "Permanently delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Reset password dialog (super admin sets password directly)
// ---------------------------------------------------------------------------
function ResetPasswordDialog({
  employee,
  onClose,
}: {
  employee: EmployeeRow | null;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const strength = passwordStrength(password);
  const valid = strength.score === 4 && password === confirm && password.length > 0;

  const submit = async () => {
    if (!employee?.auth_user_id || !valid) return;
    setBusy(true);
    try {
      const result = await rotateUserPassword({
        data: { userId: employee.auth_user_id, newPassword: password },
      });
      if (result?.error) {
        toast.error(result.error);
      } else {
        toast.success(`Password updated for ${employee.full_name}`);
        setPassword("");
        setConfirm("");
        onClose();
        void qc.invalidateQueries({ queryKey: ["employees"] });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={employee !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set password for {employee?.full_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
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
          <p className="text-xs text-muted-foreground">
            The account owner is signed out of all devices and must use this password next.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || busy}>
            {busy ? "Updating…" : "Update password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// New employee dialog — creates a profile row and (for super admins) an auth
// account with a temp password.  Shows the temp password in a summary card.
// ---------------------------------------------------------------------------
function NewEmployeeDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("employee");
  const [teamId, setTeamId] = useState("");
  const [start, setStart] = useState(fmtISO(new Date()));
  const [busy, setBusy] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [createdName, setCreatedName] = useState("");
  const [copied, setCopied] = useState(false);
  const teams = useTeams();
  const { isSuperAdmin } = useAuth();
  const qc = useQueryClient();

  const reset = () => {
    setName("");
    setEmail("");
    setRole("employee");
    setTeamId("");
    setStart(fmtISO(new Date()));
    setTempPassword(null);
    setCreatedName("");
    setCopied(false);
    setBusy(false);
  };

  const submit = async () => {
    if (!name || !email) return toast.error("Name and email required");
    if (!isWorkEmail(email)) return toast.error(`Only @${WORK_EMAIL_DOMAIN} emails are allowed`);
    setBusy(true);

    if (isSuperAdmin) {
      // --- Step 1: insert profile row ---
      const { data: profile, error: insertErr } = await supabase
        .from("profiles")
        .insert({
          full_name: name,
          email,
          role,
          team_id: teamId || null,
          employment_start_date: start,
        })
        .select("id")
        .single();
      if (insertErr || !profile) {
        setBusy(false);
        return toast.error(insertErr?.message ?? "Failed to create profile");
      }

      // --- Step 2: create auth account with temp password ---
      const result = await createEmployeeAccount({
        data: { profileId: profile.id, email, fullName: name },
      });
      setBusy(false);
      if (result?.error) {
        return toast.error(result.error);
      }

      setTempPassword(result.tempPassword ?? null);
      setCreatedName(name);
      toast.success(`Account created for ${name}`);
      void qc.invalidateQueries({ queryKey: ["employees"] });
    } else {
      // Non-super-admin: just insert the profile (employee self-registers)
      const { error } = await supabase.from("profiles").insert({
        full_name: name,
        email,
        role,
        team_id: teamId || null,
        employment_start_date: start,
      });
      setBusy(false);
      if (error) return toast.error(error.message);
      toast.success("Employee added — they'll self-register on the sign-in page");
      setOpen(false);
      reset();
      void qc.invalidateQueries({ queryKey: ["employees"] });
    }
  };

  const copyPassword = async () => {
    if (!tempPassword) return;
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the text for manual copy
    }
  };

  const closeDialog = () => {
    setOpen(false);
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) closeDialog();
        else setOpen(true);
      }}
    >
      <DialogTrigger asChild>
        <Button onClick={() => { reset(); setOpen(true); }}>
          <UserPlus className="h-4 w-4" />
          Add employee
        </Button>
      </DialogTrigger>
      <DialogContent className={tempPassword ? "max-w-lg" : undefined}>
        {tempPassword ? (
          /* ---- Summary: show the temp password ---- */
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                Account created for {createdName}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/40">
                <p className="mb-2 text-sm font-medium text-emerald-800 dark:text-emerald-300">
                  Temporary password
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-white px-3 py-2 font-mono text-sm tracking-wide dark:bg-emerald-950">
                    {tempPassword}
                  </code>
                  <Button variant="outline" size="sm" onClick={copyPassword} className="shrink-0">
                    {copied ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border bg-card p-4 text-sm">
                <p className="mb-2 font-medium">What happens next:</p>
                <ol className="list-inside list-decimal space-y-1 text-muted-foreground">
                  <li>
                    Share this temporary password with <strong>{createdName}</strong> via a secure
                    channel (e.g. in person or encrypted message).
                  </li>
                  <li>
                    The employee logs in at <strong>{window.location.host}</strong> using their
                    email and this password.
                  </li>
                  <li>
                    On first login, they'll be <strong>forced to choose a new password</strong> before
                    they can access the dashboard.
                  </li>
                </ol>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={closeDialog}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          /* ---- Form: create the employee ---- */
          <>
            <DialogHeader>
              <DialogTitle>New employee</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Full name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Team</Label>
                  <Select value={teamId} onValueChange={setTeamId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose team" />
                    </SelectTrigger>
                    <SelectContent>
                      {(teams.data ?? []).map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Role</Label>
                  <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="employee">Employee</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      {isSuperAdmin && <SelectItem value="admin">Admin</SelectItem>}
                      {isSuperAdmin && <SelectItem value="super_admin">Super Admin</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Start date</Label>
                <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              {isSuperAdmin ? (
                <p className="text-xs text-muted-foreground">
                  A login account will be created automatically with a temporary password. The
                  employee must change it on first sign-in.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  The employee gains login access by creating an account with this exact email on the
                  sign-in page — they'll be linked to this record automatically and keep the role set
                  here.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button onClick={submit} disabled={busy}>
                {busy ? "Creating…" : isSuperAdmin ? "Create account" : "Add"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
