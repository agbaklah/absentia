import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Plus, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { ExpenseClaimDialog } from "@/components/ExpenseClaimDialog";
import { ExpenseClaimSheet } from "@/components/ExpenseClaimSheet";
import { useAuth } from "@/lib/auth-context";
import { useClaims, useEmployees } from "@/lib/data";
import {
  CATEGORY_LABEL,
  STATUS_META,
  formatMoney,
  totalsByStatus,
  type ClaimRow,
} from "@/lib/expenses";
import { fmtDayShort } from "@/lib/leave";

export const Route = createFileRoute("/_authenticated/expenses/")({
  validateSearch: (s: Record<string, unknown>) => ({
    view: typeof s.view === "string" ? s.view : "",
  }),
  component: MyExpensesPage,
});

/** Employee view: my petty-cash claims. */
function MyExpensesPage() {
  const { profile } = useAuth();
  const claims = useClaims();
  const employees = useEmployees();
  const nav = useNavigate();
  const { view } = useSearch({ from: "/_authenticated/expenses/" });
  const [editing, setEditing] = useState<ClaimRow | null | undefined>(undefined); // undefined = closed

  const mine = useMemo(
    () => (claims.data ?? []).filter((c) => c.claimant_id === profile?.id),
    [claims.data, profile?.id],
  );
  const totals = useMemo(() => totalsByStatus(mine), [mine]);
  const names = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e.full_name])),
    [employees.data],
  );
  const selected = mine.find((c) => c.id === view) ?? null;
  const currency = mine[0]?.currency ?? "GHS";

  const openClaim = (id: string) => nav({ to: "/expenses", search: { view: id } });
  const closeClaim = () => nav({ to: "/expenses", search: { view: "" } });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Petty cash"
        description="Claim back money you spent for work — upload the receipt and the CFO reimburses you."
      >
        <Button onClick={() => setEditing(null)}>
          <Plus className="h-4 w-4" />
          New claim
        </Button>
      </PageHeader>

      {mine.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="secondary" className="tabular">
            {totals.submitted.count} pending · {formatMoney(totals.submitted.amount, currency)}
          </Badge>
          <Badge variant="default" className="tabular">
            {totals.approved.count} approved · {formatMoney(totals.approved.amount, currency)}
          </Badge>
          <Badge variant="outline" className="tabular">
            {totals.paid.count} paid · {formatMoney(totals.paid.amount, currency)}
          </Badge>
        </div>
      )}

      <Card className="p-4">
        <div className="mb-3 text-sm font-medium">My claims</div>
        {claims.isLoading && (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        )}
        {!claims.isLoading && mine.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <Receipt className="h-8 w-8 opacity-50" />
            <div>No claims yet.</div>
            <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
              Create your first claim
            </Button>
          </div>
        )}
        <div className="divide-y">
          {mine.map((c) => {
            const s = STATUS_META[c.status];
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => openClaim(c.id)}
                className="flex w-full flex-wrap items-center justify-between gap-2 py-3 text-left text-sm transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground tabular">#{c.claim_no}</span>
                    <span className="truncate font-medium">{c.title}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {CATEGORY_LABEL[c.category] ?? c.category} · {fmtDayShort(c.expense_date)}
                    {c.decision_note && c.status === "rejected" ? ` · “${c.decision_note}”` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-medium tabular">{formatMoney(c.amount, c.currency)}</span>
                  <Badge variant={s.tone} className="w-20 justify-center">
                    {s.label}
                  </Badge>
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <ExpenseClaimDialog
        open={editing !== undefined}
        onOpenChange={(o) => !o && setEditing(undefined)}
        claim={editing ?? null}
      />
      <ExpenseClaimSheet
        claim={selected}
        names={names}
        onClose={closeClaim}
        onEdit={(c) => {
          closeClaim();
          setEditing(c);
        }}
      />
    </div>
  );
}
