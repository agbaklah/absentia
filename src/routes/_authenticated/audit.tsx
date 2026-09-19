import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Download, ScrollText, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { InitialsAvatar } from "@/components/InitialsAvatar";
import { useAuth } from "@/lib/auth-context";
import { useAuditLog, useEmployees } from "@/lib/data";
import { describeAudit } from "@/lib/audit";
import { fmtTimestamp } from "@/lib/leave";

export const Route = createFileRoute("/_authenticated/audit")({
  component: AuditPage,
});

const ENTITY_LABEL: Record<string, string> = {
  leave_entry: "Leave",
  leave_request: "Leave",
  expense_claim: "Petty cash",
  profile: "Employee",
};

const ACTION_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  approved: "default",
  paid: "default",
  rejected: "destructive",
  cancelled: "outline",
  requested: "secondary",
  created: "secondary",
  submitted: "secondary",
};

function AuditPage() {
  const { loading, isAdmin, isViewer } = useAuth();
  const audit = useAuditLog({ enabled: isAdmin || isViewer, limit: 500 });
  const employees = useEmployees();
  const [q, setQ] = useState("");
  const [entity, setEntity] = useState("all");

  const names = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e.full_name])),
    [employees.data],
  );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (audit.data ?? [])
      .filter((r) => entity === "all" || r.entity === entity)
      .map((r) => ({
        r,
        text: describeAudit(r, names),
        actor: names.get(r.actor_id ?? "") ?? "System",
      }))
      .filter(
        (x) =>
          !needle ||
          x.text.toLowerCase().includes(needle) ||
          x.actor.toLowerCase().includes(needle) ||
          x.r.action.toLowerCase().includes(needle),
      );
  }, [audit.data, entity, q, names]);

  const exportCsv = () => {
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [
      ["When", "Actor", "Entity", "Action", "Summary"],
      ...rows.map((x) => [
        x.r.ts,
        x.actor,
        ENTITY_LABEL[x.r.entity] ?? x.r.entity,
        x.r.action,
        x.text,
      ]),
    ]
      .map((r) => r.map(esc).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return null;
  if (!isAdmin && !isViewer) return <Navigate to="/dashboard" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Who did what, and when — leave decisions, petty cash, and admin changes."
      >
        <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </PageHeader>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-9 w-64 pl-8"
            />
          </div>
          <Select value={entity} onValueChange={setEntity}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everything</SelectItem>
              <SelectItem value="leave_request">Leave decisions</SelectItem>
              <SelectItem value="leave_entry">Leave requests</SelectItem>
              <SelectItem value="expense_claim">Petty cash</SelectItem>
            </SelectContent>
          </Select>
          <span className="ml-auto text-xs text-muted-foreground">
            {rows.length} of {(audit.data ?? []).length} most recent events
          </span>
        </div>
        <div className="divide-y">
          {rows.map(({ r, text, actor }) => (
            <div key={r.id} className="flex items-start gap-3 py-2.5 text-sm">
              <InitialsAvatar name={actor} className="mt-0.5 h-7 w-7 text-[10px]" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-medium">{actor}</span>
                  <Badge variant={ACTION_TONE[r.action] ?? "outline"} className="capitalize">
                    {r.action}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {ENTITY_LABEL[r.entity] ?? r.entity}
                  </span>
                </div>
                <div className="truncate text-xs text-muted-foreground">{text}</div>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{fmtTimestamp(r.ts)}</span>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
              <ScrollText className="h-7 w-7 opacity-40" />
              {audit.isLoading ? "Loading…" : "No events match."}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
