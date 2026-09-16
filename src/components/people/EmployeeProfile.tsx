import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useAllProfiles, useChecklists, useEmployees, type EmployeeRow } from "@/lib/data";
import { ProfileHeaderCard } from "@/components/people/ProfileHeaderCard";
import { PrivateRecordCard } from "@/components/people/PrivateRecordCard";
import { DocumentsCard } from "@/components/people/DocumentsCard";
import { HistoryCard } from "@/components/people/HistoryCard";
import { ChecklistCard } from "@/components/people/ChecklistCard";
import { BalanceHistory } from "@/components/BalanceHistory";

/** Full employee record — used by /employees/$id (management) and /profile (self). */
export function EmployeeProfile({ employee, self }: { employee: EmployeeRow; self: boolean }) {
  const { isAdmin, isManagement } = useAuth();
  const qc = useQueryClient();
  const employees = useEmployees();
  const all = useAllProfiles({ enabled: isAdmin });
  const checklists = useChecklists();
  const names = useMemo(
    () => new Map([...(employees.data ?? []), ...(all.data ?? [])].map((e) => [e.id, e.full_name])),
    [employees.data, all.data],
  );
  const mine = (checklists.data?.checklists ?? []).filter((c) => c.profile_id === employee.id);
  const canSeePrivate = isAdmin || self;

  const start = async (kind: "onboarding" | "offboarding") => {
    const { error } = await supabase.rpc("start_checklist", {
      _employee: employee.id,
      _kind: kind,
    });
    if (error) return toast.error(error.message);
    toast.success(`${kind} checklist started`);
    void qc.invalidateQueries({ queryKey: ["checklists"] });
  };

  return (
    <div className="space-y-4">
      <ProfileHeaderCard employee={employee} self={self} />
      <Tabs defaultValue={canSeePrivate ? "personal" : "history"}>
        <TabsList className="flex-wrap">
          {canSeePrivate && <TabsTrigger value="personal">Personal</TabsTrigger>}
          {(isManagement || self) && <TabsTrigger value="leave">Leave balance</TabsTrigger>}
          {canSeePrivate && <TabsTrigger value="documents">Documents</TabsTrigger>}
          <TabsTrigger value="history">Job history</TabsTrigger>
          <TabsTrigger value="checklists">Checklists</TabsTrigger>
        </TabsList>
        {canSeePrivate && (
          <TabsContent value="personal" className="mt-3">
            <PrivateRecordCard profileId={employee.id} self={self} />
          </TabsContent>
        )}
        {(isManagement || self) && (
          <TabsContent value="leave" className="mt-3">
            <Card className="p-5">
              <BalanceHistory employeeId={employee.id} policyId={employee.policy_id ?? null} />
            </Card>
          </TabsContent>
        )}
        {canSeePrivate && (
          <TabsContent value="documents" className="mt-3">
            <DocumentsCard profileId={employee.id} self={self} />
          </TabsContent>
        )}
        <TabsContent value="history" className="mt-3">
          <HistoryCard profileId={employee.id} />
        </TabsContent>
        <TabsContent value="checklists" className="mt-3 space-y-3">
          {mine.map((c) => (
            <ChecklistCard
              key={c.id}
              checklist={c}
              tasks={(checklists.data?.tasks ?? []).filter((t) => t.checklist_id === c.id)}
              names={names}
            />
          ))}
          {mine.length === 0 && (
            <Card className="p-5 text-sm text-muted-foreground">
              No checklists for this employee.
            </Card>
          )}
          {isAdmin && (
            <div className="flex gap-2">
              {!mine.some((c) => c.kind === "onboarding") && (
                <Button variant="outline" size="sm" onClick={() => start("onboarding")}>
                  Start onboarding
                </Button>
              )}
              {!mine.some((c) => c.kind === "offboarding") && (
                <Button variant="outline" size="sm" onClick={() => start("offboarding")}>
                  Start offboarding
                </Button>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
