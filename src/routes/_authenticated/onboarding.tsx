import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { ChecklistCard } from "@/components/people/ChecklistCard";
import { useAuth } from "@/lib/auth-context";
import { useAllProfiles, useChecklists, useEmployees } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: OnboardingPage,
});

/** Onboarding / offboarding checklists: my tasks first, then everything I can see. */
function OnboardingPage() {
  const { profile, isAdmin } = useAuth();
  const data = useChecklists();
  const employees = useEmployees();
  const all = useAllProfiles({ enabled: isAdmin });
  const names = useMemo(
    () => new Map([...(employees.data ?? []), ...(all.data ?? [])].map((e) => [e.id, e.full_name])),
    [employees.data, all.data],
  );
  const checklists = data.data?.checklists ?? [];
  const tasks = data.data?.tasks ?? [];
  const myOpen = tasks.filter((t) => t.assignee_id === profile?.id && !t.done_at);
  const withMyTasks = checklists.filter((c) => myOpen.some((t) => t.checklist_id === c.id));
  const active = checklists.filter((c) => !c.completed_at);
  const done = checklists.filter((c) => c.completed_at);

  const render = (list: typeof checklists) =>
    list.length === 0 ? (
      <Card className="p-5 text-sm text-muted-foreground">Nothing here.</Card>
    ) : (
      <div className="grid gap-3 lg:grid-cols-2">
        {list.map((c) => (
          <ChecklistCard
            key={c.id}
            checklist={c}
            tasks={tasks.filter((t) => t.checklist_id === c.id)}
            names={names}
            personName={names.get(c.profile_id) ?? "—"}
          />
        ))}
      </div>
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Onboarding & offboarding"
        description={`${myOpen.length} task${myOpen.length === 1 ? "" : "s"} assigned to you.`}
      />
      <Tabs defaultValue={myOpen.length ? "mine" : "active"}>
        <TabsList>
          <TabsTrigger value="mine">
            My tasks {myOpen.length ? `(${myOpen.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="active">In progress ({active.length})</TabsTrigger>
          <TabsTrigger value="done">Completed ({done.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="mine" className="mt-4">
          {render(withMyTasks)}
        </TabsContent>
        <TabsContent value="active" className="mt-4">
          {render(active)}
        </TabsContent>
        <TabsContent value="done" className="mt-4">
          {render(done)}
        </TabsContent>
      </Tabs>
    </div>
  );
}
