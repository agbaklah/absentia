import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Mail, Network, Phone, Search, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useEmployees, useTeams } from "@/lib/data";
import { buildOrgTree, type OrgNode } from "@/lib/people";

export const Route = createFileRoute("/_authenticated/directory")({
  component: DirectoryPage,
});

/** Company directory + org chart, visible to everyone. */
function DirectoryPage() {
  const { isManagement } = useAuth();
  const employees = useEmployees();
  const teams = useTeams();
  const [q, setQ] = useState("");
  const [team, setTeam] = useState("all");

  const people = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (employees.data ?? [])
      .filter((e) => team === "all" || e.team_id === team)
      .filter(
        (e) =>
          !needle ||
          e.full_name.toLowerCase().includes(needle) ||
          (e.job_title ?? "").toLowerCase().includes(needle) ||
          e.email.toLowerCase().includes(needle),
      );
  }, [employees.data, q, team]);

  const tree = useMemo(
    () => buildOrgTree(employees.data ?? [], teams.data ?? []),
    [employees.data, teams.data],
  );
  const teamName = (id: string | null) => (teams.data ?? []).find((t) => t.id === id)?.name ?? "—";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Directory"
        description="Everyone at the company, and who reports to whom."
      />
      <Tabs defaultValue="people">
        <div className="flex flex-wrap items-center gap-2">
          <TabsList>
            <TabsTrigger value="people" className="gap-1.5">
              <Users className="h-3.5 w-3.5" /> People
            </TabsTrigger>
            <TabsTrigger value="chart" className="gap-1.5">
              <Network className="h-3.5 w-3.5" /> Org chart
            </TabsTrigger>
          </TabsList>
          <div className="relative ml-auto">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search name, title…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-9 w-56 pl-8"
            />
          </div>
          <Select value={team} onValueChange={setTeam}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All teams</SelectItem>
              {(teams.data ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <TabsContent value="people" className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {people.map((e) => (
              <Card key={e.id} className="flex items-start gap-3 p-4">
                <InitialsAvatar name={e.full_name} className="h-11 w-11 text-sm" />
                <div className="min-w-0 flex-1 text-sm">
                  {isManagement ? (
                    <Link
                      to="/employees/$id"
                      params={{ id: e.id }}
                      className="font-medium hover:underline"
                    >
                      {e.full_name}
                    </Link>
                  ) : (
                    <div className="font-medium">{e.full_name}</div>
                  )}
                  <div className="truncate text-xs text-muted-foreground">
                    {e.job_title ?? "—"} · {teamName(e.team_id)}
                  </div>
                  <div className="mt-1.5 space-y-0.5 text-xs">
                    <a
                      href={`mailto:${e.email}`}
                      className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                    >
                      <Mail className="h-3 w-3" /> <span className="truncate">{e.email}</span>
                    </a>
                    {e.phone && (
                      <a
                        href={`tel:${e.phone}`}
                        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                      >
                        <Phone className="h-3 w-3" /> {e.phone}
                      </a>
                    )}
                  </div>
                </div>
              </Card>
            ))}
            {people.length === 0 && (
              <div className="text-sm text-muted-foreground">Nobody matches.</div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="chart" className="mt-4">
          <Card className="overflow-x-auto p-5">
            <div className="flex min-w-max gap-6">
              {tree.map((n) => (
                <OrgBranch key={n.id} node={n} depth={0} />
              ))}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OrgBranch({ node, depth }: { node: OrgNode; depth: number }) {
  const isGroup = node.id.startsWith("team:");
  return (
    <div className="flex flex-col items-center">
      <div
        className={`rounded-lg border px-3 py-2 text-center text-sm ${isGroup ? "border-dashed bg-muted/30" : "bg-card shadow-sm"}`}
      >
        {!isGroup && (
          <InitialsAvatar name={node.name} className="mx-auto mb-1 h-8 w-8 text-[10px]" />
        )}
        <div className="font-medium">{node.name}</div>
        <div className="text-xs text-muted-foreground">{node.title ?? node.teamName ?? ""}</div>
      </div>
      {node.children.length > 0 && (
        <>
          <div className="h-4 w-px bg-border" />
          <div className="flex gap-3 border-t pt-4">
            {node.children.map((c) => (
              <OrgBranch key={c.id} node={c} depth={depth + 1} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
