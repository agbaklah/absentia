import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Banknote,
  CheckCircle2,
  Eye,
  FileText,
  Loader2,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { InitialsAvatar } from "@/components/InitialsAvatar";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth-context";
import { useReceipts } from "@/lib/data";
import { ReceiptViewer } from "@/components/ReceiptViewer";
import {
  CATEGORY_LABEL,
  PAYMENT_LABEL,
  PAYMENT_METHODS,
  STATUS_META,
  actionsFor,
  fmtBytes,
  formatMoney,
  type ClaimAction,
  type ClaimRow,
  type PaymentMethod,
} from "@/lib/expenses";
import { fmtDayShort, fmtTimestamp } from "@/lib/leave";
import { cn } from "@/lib/utils";

/**
 * Detail view for one claim, shared by the employee page and the CFO queue.
 * Actions are role-aware (`actionsFor`) and every one is re-validated by the
 * `expense_claim_transition` trigger, so a stale UI can't do anything the
 * database wouldn't allow.
 */
export function ExpenseClaimSheet({
  claim,
  names,
  onClose,
  onEdit,
}: {
  claim: ClaimRow | null;
  /** profile id → full name, for claimant / reviewer / payer labels. */
  names: Map<string, string>;
  onClose: () => void;
  onEdit: (claim: ClaimRow) => void;
}) {
  const { profile, canDecideExpenses } = useAuth();
  const qc = useQueryClient();
  const receipts = useReceipts(claim?.id ?? null);
  const [busy, setBusy] = useState<ClaimAction | null>(null);
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("momo");
  const [ref, setRef] = useState("");
  const [confirm, setConfirm] = useState<"delete" | "reject" | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [viewing, setViewing] = useState<number | null>(null);

  // Reset decision inputs when switching claims.
  useEffect(() => {
    setNote("");
    setRef("");
    setMethod("momo");
    setBusy(null);
    setConfirm(null);
  }, [claim?.id]);

  // Signed URLs for receipts (private bucket).
  useEffect(() => {
    const paths = (receipts.data ?? []).map((r) => r.storage_path);
    if (paths.length === 0) return;
    let alive = true;
    void supabase.storage
      .from("receipts")
      .createSignedUrls(paths, 3600)
      .then(({ data }) => {
        if (!alive || !data) return;
        const next: Record<string, string> = {};
        for (const d of data) if (d.path && d.signedUrl) next[d.path] = d.signedUrl;
        setUrls(next);
      });
    return () => {
      alive = false;
    };
  }, [receipts.data]);

  const actions = useMemo(
    () =>
      claim
        ? actionsFor(claim, { profileId: profile?.id ?? null, canDecide: canDecideExpenses })
        : [],
    [claim, profile?.id, canDecideExpenses],
  );
  const can = (a: ClaimAction) => actions.includes(a);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["claims"] });
    void qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  const transition = async (
    action: ClaimAction,
    patch: Database["public"]["Tables"]["expense_claims"]["Update"],
    okMsg: string,
    close = true,
  ) => {
    if (!claim) return;
    setBusy(action);
    const { data, error } = await supabase
      .from("expense_claims")
      .update(patch)
      .eq("id", claim.id)
      .select("id");
    setBusy(null);
    if (error) return toast.error(error.message);
    if (!data || data.length === 0)
      return toast.error("No changes were made — you may not have permission for this claim.");
    toast.success(okMsg);
    refresh();
    if (close) onClose();
  };

  const remove = async () => {
    if (!claim) return;
    setBusy("delete");
    const paths = (receipts.data ?? []).map((r) => r.storage_path);
    const { error } = await supabase.from("expense_claims").delete().eq("id", claim.id);
    if (!error && paths.length) await supabase.storage.from("receipts").remove(paths);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Draft deleted");
    refresh();
    onClose();
  };

  const status = claim ? STATUS_META[claim.status] : null;
  const isOwner = claim?.claimant_id === profile?.id;

  return (
    <>
      <Sheet open={!!claim} onOpenChange={(o) => !o && !busy && onClose()}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
          {claim && status && (
            <>
              <SheetHeader className="space-y-1 border-b px-5 py-4 pr-12 text-left">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Claim #{claim.claim_no}
                    </div>
                    <SheetTitle className="truncate text-lg">{claim.title}</SheetTitle>
                  </div>
                  <Badge variant={status.tone} className="shrink-0 capitalize">
                    {status.label}
                  </Badge>
                </div>
                <SheetDescription>{status.hint}</SheetDescription>
              </SheetHeader>

              <div className="flex-1 space-y-5 px-5 py-4">
                <div className="flex items-end justify-between gap-3 rounded-lg border bg-muted/30 p-3">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Amount
                    </div>
                    <div className="whitespace-nowrap font-display text-2xl font-semibold tabular">
                      {formatMoney(claim.amount, claim.currency)}
                    </div>
                  </div>
                  <div className="min-w-0 text-right text-xs text-muted-foreground">
                    <div>{CATEGORY_LABEL[claim.category] ?? claim.category}</div>
                    <div>{fmtDayShort(claim.expense_date)}</div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <InitialsAvatar
                    name={names.get(claim.claimant_id) ?? "?"}
                    className="h-9 w-9 text-xs"
                  />
                  <div className="min-w-0 text-sm">
                    <div className="font-medium">{names.get(claim.claimant_id) ?? "Unknown"}</div>
                    <div className="text-xs text-muted-foreground">
                      Created {fmtTimestamp(claim.created_at)}
                    </div>
                  </div>
                </div>

                {claim.description && (
                  <Section label="Details">
                    <p className="whitespace-pre-wrap rounded-md border bg-background p-2 text-sm">
                      {claim.description}
                    </p>
                  </Section>
                )}

                <Section label={`Receipts (${receipts.data?.length ?? 0})`}>
                  {receipts.isLoading && (
                    <div className="text-xs text-muted-foreground">Loading…</div>
                  )}
                  {receipts.data?.length === 0 && (
                    <div className="text-xs text-muted-foreground">No receipts attached.</div>
                  )}
                  <ul className="grid grid-cols-2 gap-2">
                    {(receipts.data ?? []).map((r, i) => {
                      const url = urls[r.storage_path];
                      const img = r.mime_type.startsWith("image/");
                      return (
                        <li key={r.id} className="overflow-hidden rounded-md border">
                          <button
                            type="button"
                            onClick={() => setViewing(i)}
                            className="block w-full text-left transition-colors hover:bg-muted/60"
                          >
                            <div className="flex aspect-[4/3] items-center justify-center bg-muted/40">
                              {img && url ? (
                                <img
                                  src={url}
                                  alt={r.file_name}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <FileText className="h-8 w-8 text-muted-foreground" />
                              )}
                            </div>
                            <div className="flex items-center gap-1 px-2 py-1.5 text-xs">
                              <span className="min-w-0 flex-1 truncate" title={r.file_name}>
                                {r.file_name}
                              </span>
                              <span className="shrink-0 text-muted-foreground">
                                {fmtBytes(r.size_bytes)}
                              </span>
                              <Eye className="h-3 w-3 shrink-0 text-muted-foreground" />
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <ReceiptViewer
                    files={(receipts.data ?? []).map((r) => ({
                      name: r.file_name,
                      mime: r.mime_type,
                      size: r.size_bytes,
                      url: urls[r.storage_path] ?? null,
                    }))}
                    index={viewing}
                    onIndexChange={setViewing}
                    onClose={() => setViewing(null)}
                  />
                </Section>

                <Section label="Timeline">
                  <ol className="space-y-1.5 text-sm">
                    <Step done label="Created" when={claim.created_at} />
                    <Step done={!!claim.submitted_at} label="Submitted" when={claim.submitted_at} />
                    {claim.status === "rejected" ? (
                      <Step
                        done
                        tone="destructive"
                        label={`Rejected by ${names.get(claim.reviewed_by ?? "") ?? "reviewer"}`}
                        when={claim.reviewed_at}
                      />
                    ) : (
                      <Step
                        done={!!claim.reviewed_at && claim.status !== "submitted"}
                        label={
                          claim.reviewed_by
                            ? `Approved by ${names.get(claim.reviewed_by) ?? "reviewer"}`
                            : "Approved"
                        }
                        when={claim.status === "submitted" ? null : claim.reviewed_at}
                      />
                    )}
                    {claim.status !== "rejected" && (
                      <Step
                        done={claim.status === "paid"}
                        label={
                          claim.status === "paid"
                            ? `Paid by ${names.get(claim.paid_by ?? "") ?? "CFO"} · ${
                                claim.payment_method ? PAYMENT_LABEL[claim.payment_method] : ""
                              }${claim.payment_ref ? ` · ref ${claim.payment_ref}` : ""}`
                            : "Paid"
                        }
                        when={claim.paid_at}
                      />
                    )}
                  </ol>
                </Section>

                {claim.decision_note && (
                  <Section label="Reviewer note">
                    <p className="rounded-md border border-primary/30 bg-primary/5 p-2 text-sm">
                      {claim.decision_note}
                    </p>
                  </Section>
                )}

                {/* Reviewer controls ------------------------------------ */}
                {(can("approve") || can("reject") || can("pay")) && (
                  <div className="space-y-3 rounded-lg border p-3">
                    <div className="text-sm font-medium">
                      {can("pay") ? "Reimburse" : "Decision"}
                    </div>
                    {can("pay") && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Payment method</Label>
                          <Select
                            value={method}
                            onValueChange={(v) => setMethod(v as PaymentMethod)}
                          >
                            <SelectTrigger className="h-9">
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
                        <div className="space-y-1">
                          <Label className="text-xs">Reference (optional)</Label>
                          <Input
                            className="h-9"
                            value={ref}
                            onChange={(e) => setRef(e.target.value)}
                            placeholder="MoMo / bank ref"
                          />
                        </div>
                      </div>
                    )}
                    <Textarea
                      rows={2}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={
                        can("pay")
                          ? "Note to the employee (optional)"
                          : "Reason or note for the employee (recommended when rejecting)"
                      }
                      className="text-sm"
                    />
                    <div className="flex flex-wrap justify-end gap-2">
                      {can("reject") && (
                        <Button
                          variant="outline"
                          className="text-red-600 hover:text-red-700"
                          disabled={!!busy}
                          onClick={() => setConfirm("reject")}
                        >
                          <XCircle className="h-4 w-4" />
                          Reject
                        </Button>
                      )}
                      {can("approve") && (
                        <Button
                          disabled={!!busy}
                          onClick={() =>
                            transition(
                              "approve",
                              { status: "approved", decision_note: note.trim() || null },
                              `Claim #${claim.claim_no} approved`,
                            )
                          }
                        >
                          {busy === "approve" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                          Approve
                        </Button>
                      )}
                      {can("pay") && (
                        <Button
                          disabled={!!busy}
                          onClick={() =>
                            transition(
                              "pay",
                              {
                                status: "paid",
                                payment_method: method,
                                payment_ref: ref.trim() || null,
                                decision_note: note.trim() || claim.decision_note,
                              },
                              `Claim #${claim.claim_no} marked as paid`,
                            )
                          }
                        >
                          {busy === "pay" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Banknote className="h-4 w-4" />
                          )}
                          Mark as paid
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Owner controls -------------------------------------------- */}
              {isOwner && actions.length > 0 && (
                <div className="flex flex-wrap justify-end gap-2 border-t bg-muted/20 px-5 py-3">
                  {can("delete") && (
                    <Button
                      variant="ghost"
                      className="mr-auto text-red-600 hover:text-red-700"
                      disabled={!!busy}
                      onClick={() => setConfirm("delete")}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </Button>
                  )}
                  {can("withdraw") && (
                    <Button
                      variant="outline"
                      disabled={!!busy}
                      onClick={() =>
                        transition("withdraw", { status: "draft" }, "Claim withdrawn to draft")
                      }
                    >
                      <Undo2 className="h-4 w-4" />
                      Withdraw
                    </Button>
                  )}
                  {can("reopen") && (
                    <Button
                      variant="outline"
                      disabled={!!busy}
                      onClick={() =>
                        transition(
                          "reopen",
                          { status: "draft" },
                          "Claim reopened as a draft — edit and resubmit",
                        )
                      }
                    >
                      <RotateCcw className="h-4 w-4" />
                      Reopen
                    </Button>
                  )}
                  {can("edit") && (
                    <Button variant="outline" disabled={!!busy} onClick={() => onEdit(claim)}>
                      <Pencil className="h-4 w-4" />
                      Edit
                    </Button>
                  )}
                  {can("submit") && (
                    <Button
                      disabled={!!busy}
                      onClick={() =>
                        transition("submit", { status: "submitted" }, "Claim submitted to the CFO")
                      }
                    >
                      {busy === "submit" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Submit
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "delete" ? "Delete this draft?" : `Reject claim #${claim?.claim_no}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "delete"
                ? "The claim and its uploaded receipts will be removed. This cannot be undone."
                : note.trim()
                  ? `The employee will see your note: “${note.trim()}”`
                  : "Consider adding a note so the employee knows why."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const which = confirm;
                setConfirm(null);
                if (which === "delete") void remove();
                else if (claim)
                  void transition(
                    "reject",
                    { status: "rejected", decision_note: note.trim() || null },
                    `Claim #${claim.claim_no} rejected`,
                  );
              }}
            >
              {confirm === "delete" ? "Delete" : "Reject"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function Step({
  done,
  label,
  when,
  tone,
}: {
  done: boolean;
  label: string;
  when: string | null;
  tone?: "destructive";
}) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={cn(
          "h-2.5 w-2.5 shrink-0 rounded-full border",
          done
            ? tone === "destructive"
              ? "border-red-600 bg-red-600"
              : "border-primary bg-primary"
            : "border-muted-foreground/40 bg-transparent",
        )}
      />
      <span className={cn("flex-1", !done && "text-muted-foreground")}>{label}</span>
      {when && <span className="text-xs text-muted-foreground">{fmtTimestamp(when)}</span>}
    </li>
  );
}
