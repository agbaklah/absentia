import { createFileRoute, Navigate, useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Banknote, Clock3, Download, Loader2, Search, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { InitialsAvatar } from "@/components/InitialsAvatar";
import { ExpenseClaimDialog } from "@/components/ExpenseClaimDialog";
import { ExpenseClaimSheet } from "@/components/ExpenseClaimSheet";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useClaims, useEmployees, useSettings } from "@/lib/data";
import {
  CATEGORY_LABEL,
  PAYMENT_METHODS,
  STATUS_META,
  claimsToCsv,
  formatMoney,
  paidInMonth,
  totalsByStatus,
  type ClaimRow,
  type ExpenseStatus,
  type PaymentMethod,
} from "@/lib/expenses";
import { fmtDayShort, fmtTimestamp } from "@/lib/leave";

export const Route = createFileRoute("/_authenticated/expenses/review")({
  validateSearch: (s: Record<string, unknown>) => ({
    view: typeof s.view === "string" ? s.view : "",
    tab: typeof s.tab === "string" ? s.tab : "submitted",
  }),
  component: ReviewPage,
});

type Tab = ExpenseStatus | "all";
const TABS: { key: Tab; label: string }[] = [
  { key: "submitted", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "paid", label: "Paid" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

/** CFO queue (admins read-only): review, reimburse, export. */
function ReviewPage() {
  const { loading, canReviewExpenses, canDecideExpenses, profile } = useAuth();
  const claims = useClaims({ enabled: canReviewExpenses });
  const employees = useEmployees();
  const settings = useSettings();
  const nav = useNavigate();
  const { view, tab } = useSearch({ from: "/_authenticated/expenses/review" });
  const [q, setQ] = useState("");
  const [claimant, setClaimant] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState<ClaimRow | null | undefined>(undefined);

  const names = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e.full_name])),
    [employees.data],
  );
  const all = useMemo(() => claims.data ?? [], [claims.data]);
  const currency = settings.data?.currency ?? all[0]?.currency ?? "GHS";
  const totals = useMemo(() => totalsByStatus(all), [all]);
  const [now] = useState(() => new Date());
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const paidThisMonth = useMemo(() => paidInMonth(all, ym), [all, ym]);
  const paidThisYear = useMemo(
    () =>
      all
        .filter((c) => c.status === "paid" && c.paid_at?.startsWith(String(now.getFullYear())))
        .reduce((s, c) => s + c.amount, 0),
    [all, now],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((c) => c.status !== "draft") // drafts are private to the employee
      .filter((c) => tab === "all" || c.status === tab)
      .filter((c) => claimant === "all" || c.claimant_id === claimant)
      .filter(
        (c) =>
          !needle ||
          c.title.toLowerCase().includes(needle) ||
          String(c.claim_no).includes(needle) ||
          (names.get(c.claimant_id) ?? "").toLowerCase().includes(needle),
      )
      .sort((a, b) => {
        // Oldest pending first (FIFO for the queue); newest first elsewhere.
        if (tab === "submitted") return (a.submitted_at ?? "").localeCompare(b.submitted_at ?? "");
        return b.updated_at.localeCompare(a.updated_at);
      });
  }, [all, tab, claimant, q, names]);

  const selected = all.find((c) => c.id === view) ?? null;
  const setTab = (t: string) => {
    setSelectedIds(new Set());
    void nav({ to: "/expenses/review", search: { view: "", tab: t } });
  };
  const openClaim = (id: string) => nav({ to: "/expenses/review", search: { view: id, tab } });
  const closeClaim = () => nav({ to: "/expenses/review", search: { view: "", tab } });

  const exportCsv = () => {
    const csv = claimsToCsv(filtered, names);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `petty-cash-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return null;
  if (!canReviewExpenses) return <Navigate to="/expenses" search={{ view: "" }} />;

  const payableSelected = filtered.filter(
    (c) => selectedIds.has(c.id) && c.status === "approved" && c.claimant_id !== profile?.id,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expense review"
        description={
          canDecideExpenses
            ? "Review petty cash claims, then reimburse approved ones."
            : "Read-only view of petty cash claims."
        }
      >
        <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Pending review"
          value={String(totals.submitted.count)}
          hint={formatMoney(totals.submitted.amount, currency)}
          icon={Clock3}
          tone="accent"
        />
        <KpiCard
          label="Approved · to pay"
          value={String(totals.approved.count)}
          hint={formatMoney(totals.approved.amount, currency)}
          icon={Wallet}
        />
        <KpiCard
          label="Paid this month"
          value={formatMoney(paidThisMonth, currency)}
          icon={Banknote}
          tone="info"
        />
        <KpiCard
          label={`Paid in ${now.getFullYear()}`}
          value={formatMoney(paidThisYear, currency)}
          hint={`${totals.paid.count} claims`}
          icon={Banknote}
          tone="neutral"
        />
      </div>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              {TABS.map((t) => (
                <TabsTrigger key={t.key} value={t.key} className="gap-1.5">
                  {t.label}
                  {t.key !== "all" && totals[t.key].count > 0 && (
                    <span className="rounded-full bg-muted px-1.5 text-[10px] tabular">
                      {totals[t.key].count}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="relative ml-auto">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search # / title / name…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-9 w-56 pl-8"
            />
          </div>
          <Select value={claimant} onValueChange={setClaimant}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All employees</SelectItem>
              {(employees.data ?? []).map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {tab === "approved" && canDecideExpenses && payableSelected.length > 0 && (
          <div className="mb-3 flex items-center justify-between rounded-md border bg-primary/5 px-3 py-2 text-sm">
            <span>
              {payableSelected.length} selected ·{" "}
              <b className="tabular">
                {formatMoney(
                  payableSelected.reduce((s, c) => s + c.amount, 0),
                  currency,
                )}
              </b>
            </span>
            <Button size="sm" onClick={() => setBulkOpen(true)}>
              <Banknote className="h-4 w-4" />
              Mark selected as paid
            </Button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {tab === "approved" && canDecideExpenses && <th className="w-8 px-3 py-2" />}
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">Claim</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">{tab === "submitted" ? "Waiting since" : "Updated"}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const s = STATUS_META[c.status];
                const selectable =
                  tab === "approved" && canDecideExpenses && c.claimant_id !== profile?.id;
                return (
                  <tr
                    key={c.id}
                    onClick={() => openClaim(c.id)}
                    className={`cursor-pointer border-t transition-colors hover:bg-muted/30 ${view === c.id ? "bg-muted/40" : ""}`}
                  >
                    {tab === "approved" && canDecideExpenses && (
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        {selectable && (
                          <Checkbox
                            checked={selectedIds.has(c.id)}
                            onCheckedChange={(v) =>
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (v) next.add(c.id);
                                else next.delete(c.id);
                                return next;
                              })
                            }
                            aria-label={`Select claim ${c.claim_no}`}
                          />
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 text-muted-foreground tabular">{c.claim_no}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <InitialsAvatar
                          name={names.get(c.claimant_id) ?? "?"}
                          className="h-7 w-7 text-[10px]"
                        />
                        <span className="truncate">{names.get(c.claimant_id) ?? "Unknown"}</span>
                      </div>
                    </td>
                    <td className="max-w-[16rem] px-3 py-2">
                      <div className="truncate font-medium">{c.title}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {CATEGORY_LABEL[c.category] ?? c.category}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {fmtDayShort(c.expense_date)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular">
                      {formatMoney(c.amount, c.currency)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={s.tone}>{s.label}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                      {fmtTimestamp(tab === "submitted" ? c.submitted_at : c.updated_at) ?? "—"}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                    {claims.isLoading ? "Loading…" : "Nothing here."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <ExpenseClaimSheet
        claim={selected}
        names={names}
        onClose={closeClaim}
        onEdit={(c) => {
          closeClaim();
          setEditing(c);
        }}
      />
      <ExpenseClaimDialog
        open={editing !== undefined}
        onOpenChange={(o) => !o && setEditing(undefined)}
        claim={editing ?? null}
      />
      <BulkPayDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        claims={payableSelected}
        currency={currency}
        onDone={() => setSelectedIds(new Set())}
      />
    </div>
  );
}

function BulkPayDialog({
  open,
  onOpenChange,
  claims,
  currency,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  claims: ClaimRow[];
  currency: string;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [method, setMethod] = useState<PaymentMethod>("momo");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const total = claims.reduce((s, c) => s + c.amount, 0);

  const pay = async () => {
    setBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (const c of claims) {
      const { data, error } = await supabase
        .from("expense_claims")
        .update({ status: "paid", payment_method: method, payment_ref: ref.trim() || null })
        .eq("id", c.id)
        .select("id");
      if (error || !data?.length)
        failed.push(`#${c.claim_no}${error ? ` (${error.message})` : ""}`);
      else ok += 1;
    }
    setBusy(false);
    void qc.invalidateQueries({ queryKey: ["claims"] });
    if (ok) toast.success(`${ok} claim${ok !== 1 ? "s" : ""} marked as paid`);
    if (failed.length) toast.error(`Could not pay ${failed.join(", ")}`);
    onDone();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark {claims.length} claims as paid</DialogTitle>
          <DialogDescription>
            Total <b className="tabular">{formatMoney(total, currency)}</b>. The same payment method
            and reference are recorded on every claim.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Payment method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m.code} value={m.code}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Reference (optional)</Label>
            <Input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="Batch / transfer ref"
            />
          </div>
        </div>
        <ul className="max-h-40 divide-y overflow-y-auto rounded-md border text-sm">
          {claims.map((c) => (
            <li key={c.id} className="flex justify-between px-3 py-1.5">
              <span className="truncate">
                #{c.claim_no} · {c.title}
              </span>
              <span className="tabular">{formatMoney(c.amount, c.currency)}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={pay} disabled={busy || claims.length === 0}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
            Confirm payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
