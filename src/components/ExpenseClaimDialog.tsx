import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, FileText, ImagePlus, Loader2, Trash2, Upload, X } from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useReceipts, useSettings } from "@/lib/data";
import {
  EXPENSE_CATEGORIES,
  canSubmit,
  fmtBytes,
  formatMoney,
  parseAmount,
  receiptPath,
  validateReceiptFile,
  type ClaimRow,
  type ReceiptRow,
} from "@/lib/expenses";
import { fmtISO } from "@/lib/leave";
import { ReceiptViewer, type ViewerFile } from "@/components/ReceiptViewer";
import { cn } from "@/lib/utils";

type PendingFile = { id: string; file: File; preview: string | null };

/**
 * Create or edit a petty-cash claim while it is a draft.
 *
 * Receipts are uploaded to the private `receipts` bucket under
 * <claimant>/<claim>/… (the path the storage + table RLS expects), then
 * registered in `expense_receipts`. "Submit" saves the draft first, then asks
 * the database to move it to `submitted` — the trigger re-validates receipts
 * and the petty-cash limit server-side.
 */
export function ExpenseClaimDialog({
  open,
  onOpenChange,
  claim,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Existing draft to edit; omit to create a new claim. */
  claim?: ClaimRow | null;
}) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const settings = useSettings();
  const existing = useReceipts(claim?.id ?? null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(fmtISO(new Date()));
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [signed, setSigned] = useState<Record<string, string>>({});

  // (Re)load form state whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    setTitle(claim?.title ?? "");
    setDescription(claim?.description ?? "");
    setCategory(claim?.category ?? "other");
    setAmount(claim ? String(claim.amount) : "");
    setExpenseDate(claim?.expense_date ?? fmtISO(new Date()));
    setPending([]);
    setRemoved(new Set());
    setBusy(null);
  }, [open, claim]);

  // Free object URLs when previews go away.
  useEffect(
    () => () => {
      for (const p of pending) if (p.preview) URL.revokeObjectURL(p.preview);
    },
    [pending],
  );

  const currency = claim?.currency ?? settings.data?.currency ?? "GHS";
  const limit = settings.data?.petty_cash_limit ?? null;
  const keptExisting = useMemo(
    () => (existing.data ?? []).filter((r) => !removed.has(r.id)),
    [existing.data, removed],
  );
  const receiptCount = keptExisting.length + pending.length;

  // Signed URLs for already-uploaded receipts so they can be previewed while editing.
  useEffect(() => {
    const paths = keptExisting.map((r) => r.storage_path).filter((p) => !signed[p]);
    if (paths.length === 0) return;
    let alive = true;
    void supabase.storage
      .from("receipts")
      .createSignedUrls(paths, 3600)
      .then(({ data }) => {
        if (!alive || !data) return;
        setSigned((prev) => {
          const next = { ...prev };
          for (const d of data) if (d.path && d.signedUrl) next[d.path] = d.signedUrl;
          return next;
        });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keptExisting]);

  const viewerFiles: ViewerFile[] = [
    ...keptExisting.map((r) => ({
      name: r.file_name,
      mime: r.mime_type,
      size: r.size_bytes,
      url: signed[r.storage_path] ?? null,
    })),
    ...pending.map((p) => ({
      name: p.file.name,
      mime: p.file.type,
      size: p.file.size,
      url: p.preview ?? (p.file.type === "application/pdf" ? URL.createObjectURL(p.file) : null),
    })),
  ];
  const parsedAmount = parseAmount(amount);
  const submitCheck = canSubmit({ title, amount: parsedAmount ?? 0 }, receiptCount, limit);

  const addFiles = (files: FileList | File[]) => {
    const next: PendingFile[] = [];
    for (const file of Array.from(files)) {
      const err = validateReceiptFile(file);
      if (err) {
        toast.error(`${file.name}: ${err}`);
        continue;
      }
      next.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      });
    }
    if (next.length) setPending((p) => [...p, ...next]);
  };

  /** Persist the draft (insert or update) + receipt changes. Returns claim id. */
  const saveDraft = async (): Promise<string | null> => {
    if (!profile) return null;
    if (!title.trim()) {
      toast.error("Give the claim a title.");
      return null;
    }
    if (parsedAmount === null) {
      toast.error("Enter a valid amount (e.g. 120.50).");
      return null;
    }
    const patch = {
      title: title.trim(),
      description: description.trim() || null,
      category,
      amount: parsedAmount,
      expense_date: expenseDate,
    };
    let claimId = claim?.id ?? null;
    if (claimId) {
      const { error } = await supabase.from("expense_claims").update(patch).eq("id", claimId);
      if (error) {
        toast.error(error.message);
        return null;
      }
    } else {
      const { data, error } = await supabase
        .from("expense_claims")
        .insert({ ...patch, claimant_id: profile.id, currency })
        .select("id")
        .single();
      if (error || !data) {
        toast.error(error?.message ?? "Could not create claim");
        return null;
      }
      claimId = data.id;
    }

    // Remove receipts the user deleted (row first so RLS is checked, then object).
    for (const id of removed) {
      const r = (existing.data ?? []).find((x) => x.id === id);
      if (!r) continue;
      const { error } = await supabase.from("expense_receipts").delete().eq("id", id);
      if (error) {
        toast.error(`Could not remove ${r.file_name}: ${error.message}`);
        return null;
      }
      await supabase.storage.from("receipts").remove([r.storage_path]);
    }

    // Upload new receipts.
    for (const p of pending) {
      const path = receiptPath(profile.id, claimId, p.file.name, Date.now().toString(36));
      const up = await supabase.storage
        .from("receipts")
        .upload(path, p.file, { contentType: p.file.type, upsert: false });
      if (up.error) {
        toast.error(`Upload failed for ${p.file.name}: ${up.error.message}`);
        return null;
      }
      const { error } = await supabase.from("expense_receipts").insert({
        claim_id: claimId,
        storage_path: path,
        file_name: p.file.name,
        mime_type: p.file.type,
        size_bytes: p.file.size,
      });
      if (error) {
        await supabase.storage.from("receipts").remove([path]);
        toast.error(`Could not register ${p.file.name}: ${error.message}`);
        return null;
      }
    }
    return claimId;
  };

  const finish = (msg: string) => {
    toast.success(msg);
    void qc.invalidateQueries({ queryKey: ["claims"] });
    void qc.invalidateQueries({ queryKey: ["receipts"] });
    onOpenChange(false);
  };

  const onSave = async () => {
    setBusy("save");
    const id = await saveDraft();
    setBusy(null);
    if (id) finish("Draft saved");
  };

  const onSubmit = async () => {
    if (!submitCheck.ok) return toast.error(submitCheck.reason);
    setBusy("submit");
    const id = await saveDraft();
    if (!id) return setBusy(null);
    const { error } = await supabase
      .from("expense_claims")
      .update({ status: "submitted" })
      .eq("id", id);
    setBusy(null);
    if (error) {
      // The draft is saved; the server explained why it can't be submitted yet.
      void qc.invalidateQueries({ queryKey: ["claims"] });
      return toast.error(error.message);
    }
    finish("Claim submitted to the CFO");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {claim ? `Edit claim #${claim.claim_no}` : "New petty cash claim"}
          </DialogTitle>
          <DialogDescription>
            Attach the receipt(s) and submit — the CFO reviews and reimburses.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="claim-title">What was it for?</Label>
            <Input
              id="claim-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Fuel for Takoradi site visit"
              maxLength={120}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="claim-amount">Amount ({currency})</Label>
              <Input
                id="claim-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
              {limit && limit > 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  Limit per claim: {formatMoney(limit, currency)}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="claim-date">Expense date</Label>
              <Input
                id="claim-date"
                type="date"
                value={expenseDate}
                max={fmtISO(new Date())}
                onChange={(e) => setExpenseDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="claim-desc">Details (optional)</Label>
            <Textarea
              id="claim-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Who, where, why — anything the CFO should know."
            />
          </div>

          {/* Receipts ---------------------------------------------------- */}
          <div className="space-y-2">
            <Label>
              Receipts <span className="text-red-500">*</span>{" "}
              <span className="font-normal text-muted-foreground">
                ({receiptCount} attached · JPG, PNG, PDF · max 10 MB)
              </span>
            </Label>
            {receiptCount === 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                A receipt is required — the claim can be saved as a draft, but not submitted,
                without one.
              </p>
            )}
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInput.current?.click()}
              onKeyDown={(e) => e.key === "Enter" && fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addFiles(e.dataTransfer.files);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-4 text-center text-sm transition-colors",
                dragging
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/30 hover:bg-muted/40",
              )}
            >
              <Upload className="h-5 w-5 text-muted-foreground" />
              <span>
                <span className="font-medium text-primary">Choose files</span> or drag them here
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => cameraInput.current?.click()}
              >
                <Camera className="h-3.5 w-3.5" />
                Take photo
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => fileInput.current?.click()}
              >
                <ImagePlus className="h-3.5 w-3.5" />
                Add file
              </Button>
            </div>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={cameraInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />

            {(keptExisting.length > 0 || pending.length > 0) && (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {keptExisting.map((r, i) => (
                  <ReceiptTile
                    key={r.id}
                    name={r.file_name}
                    size={r.size_bytes}
                    mime={r.mime_type}
                    existing={r}
                    onOpen={() => setViewing(i)}
                    onRemove={() => setRemoved((s) => new Set(s).add(r.id))}
                  />
                ))}
                {pending.map((p, i) => (
                  <ReceiptTile
                    key={p.id}
                    name={p.file.name}
                    size={p.file.size}
                    mime={p.file.type}
                    preview={p.preview}
                    onOpen={() => setViewing(keptExisting.length + i)}
                    onRemove={() => setPending((list) => list.filter((x) => x.id !== p.id))}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onSave} disabled={!!busy}>
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save draft
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!!busy || !submitCheck.ok}
            title={submitCheck.ok ? undefined : submitCheck.reason}
          >
            {busy === "submit" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Submit for review
          </Button>
        </DialogFooter>
        <ReceiptViewer
          files={viewerFiles}
          index={viewing}
          onIndexChange={setViewing}
          onClose={() => setViewing(null)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ReceiptTile({
  name,
  size,
  mime,
  preview,
  existing,
  onOpen,
  onRemove,
}: {
  name: string;
  size: number;
  mime: string;
  preview?: string | null;
  existing?: ReceiptRow;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const [signed, setSigned] = useState<string | null>(null);
  useEffect(() => {
    if (!existing || !mime.startsWith("image/")) return;
    let alive = true;
    void supabase.storage
      .from("receipts")
      .createSignedUrl(existing.storage_path, 600)
      .then(({ data }) => alive && setSigned(data?.signedUrl ?? null));
    return () => {
      alive = false;
    };
  }, [existing, mime]);
  const src = preview ?? signed;
  return (
    <li className="group relative overflow-hidden rounded-md border bg-muted/30">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Preview ${name}`}
        className="flex aspect-square w-full items-center justify-center hover:bg-muted/60"
      >
        {src ? (
          <img src={src} alt={name} className="h-full w-full object-cover" />
        ) : (
          <FileText className="h-7 w-7 text-muted-foreground" />
        )}
      </button>
      <div
        className="truncate px-1.5 py-1 text-[10px] leading-tight text-muted-foreground"
        title={name}
      >
        {name}
        <span className="block">{fmtBytes(size)}</span>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        className="absolute right-1 top-1 rounded-full bg-background/90 p-1 text-muted-foreground shadow opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus:opacity-100"
      >
        {existing ? <Trash2 className="h-3 w-3" /> : <X className="h-3 w-3" />}
      </button>
    </li>
  );
}
