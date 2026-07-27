import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useEmployees, useTeams } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/employees")({
  component: EmployeesPage,
});

function EmployeesPage() {
  const employees = useEmployees();
  const teams = useTeams();
  const qc = useQueryClient();
  const [q, setQ] = useState("");

  const filtered = (employees.data ?? []).filter((e) =>
    (e.full_name + " " + e.email).toLowerCase().includes(q.toLowerCase()),
  );

  const softDelete = async (id: string) => {
    const { error } = await supabase.from("profiles").update({ active: false }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Employee archived");
    void qc.invalidateQueries({ queryKey: ["employees"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Employees</h1>
          <p className="text-sm text-muted-foreground">Manage staff, roles and team assignments.</p>
        </div>
        <div className="flex gap-2">
          <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
          <NewEmployeeDialog />
        </div>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Team</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Started</th>
              <th className="px-3 py-2 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => {
              const team = (teams.data ?? []).find((t) => t.id === e.team_id);
              return (
                <tr key={e.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{e.full_name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{e.email}</td>
                  <td className="px-3 py-2">{team?.name ?? "—"}</td>
                  <td className="px-3 py-2"><Badge variant="secondary">{e.role}</Badge></td>
                  <td className="px-3 py-2 text-muted-foreground">{e.employment_start_date}</td>
                  <td className="px-3 py-2 text-right">
                    <Button variant="ghost" size="sm" onClick={() => softDelete(e.id)}>Archive</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function NewEmployeeDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"employee" | "manager" | "admin">("employee");
  const [teamId, setTeamId] = useState("");
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const teams = useTeams();
  const qc = useQueryClient();

  const submit = async () => {
    if (!name || !email) return toast.error("Name and email required");
    const { error } = await supabase.from("profiles").insert({
      full_name: name, email, role, team_id: teamId || null, employment_start_date: start,
    });
    if (error) return toast.error(error.message);
    toast.success("Employee added");
    setOpen(false);
    void qc.invalidateQueries({ queryKey: ["employees"] });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>Add employee</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New employee</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Full name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Team</Label>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger><SelectValue placeholder="Choose team" /></SelectTrigger>
                <SelectContent>
                  {(teams.data ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as "employee" | "manager" | "admin")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Employee</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Start date</Label><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        </div>
        <DialogFooter><Button onClick={submit}>Add</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}