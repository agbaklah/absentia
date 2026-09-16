import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, FileText, FolderOpen, Loader2, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useDocuments } from "@/lib/data";
import { fmtBytes, sanitizeFileName } from "@/lib/expenses";
import { DOC_KIND_LABEL, daysUntil } from "@/lib/people";
import { fmtDayShort, fmtISO, fmtTimestamp } from "@/lib/leave";

/** Contracts, IDs, certificates… in the private `employee-docs` bucket. */
export function DocumentsCard({ profileId, self }: { profileId: string; self: boolean }) {
  const { isAdmin, profile } = useAuth();
  const docs = useDocuments(profileId);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const today = fmtISO(new Date());

  const openDoc = async (path: string) => {
    const { data, error } = await supabase.storage.from("employee-docs").createSignedUrl(path, 300);
    if (error || !data) return toast.error(error?.message ?? "Could not open document");
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const remove = async (id: string, path: string) => {
    const { error } = await supabase.from("employee_documents").delete().eq("id", id);
    if (error) return toast.error(error.message);
    await supabase.storage.from("employee-docs").remove([path]);
    toast.success("Document removed");
    void qc.invalidateQueries({ queryKey: ["documents", profileId] });
  };

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <FolderOpen className="h-4 w-4 text-emerald-700" />
        <div className="text-sm font-medium">Documents</div>
        {(isAdmin || self) && (
          <Button variant="outline" size="sm" className="ml-auto h-8" onClick={() => setOpen(true)}>
            <Upload className="h-3.5 w-3.5" />
            Upload
          </Button>
        )}
      </div>
      <ul className="divide-y text-sm">
        {(docs.data ?? []).map((d) => {
          const due = daysUntil(d.expires_at, today);
          return (
            <li key={d.id} className="flex items-center gap-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{d.title}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {DOC_KIND_LABEL[d.kind] ?? d.kind} · {fmtBytes(d.size_bytes)} ·{" "}
                  {fmtTimestamp(d.uploaded_at)}
                  {d.expires_at && (
                    <>
                      {" · "}
                      <span className={due !== null && due < 30 ? "text-amber-700" : ""}>
                        expires {fmtDayShort(d.expires_at)}
                        {due !== null && due < 0 ? " (expired)" : ""}
                      </span>
                    </>
                  )}
                </div>
              </div>
              {!d.visible_to_employee && isAdmin && (
                <Badge variant="outline" className="text-[10px]">
                  HR only
                </Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={() => openDoc(d.storage_path)}
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
              {(isAdmin || d.uploaded_by === profile?.id) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-muted-foreground hover:text-destructive"
                  onClick={() => remove(d.id, d.storage_path)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          );
        })}
        {(docs.data ?? []).length === 0 && (
          <li className="py-4 text-xs text-muted-foreground">No documents yet.</li>
        )}
      </ul>
      {open && <UploadDialog profileId={profileId} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function UploadDialog({ profileId, onClose }: { profileId: string; onClose: () => void }) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("other");
  const [expires, setExpires] = useState("");
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!file) return toast.error("Choose a file");
    if (file.size > 20 * 1024 * 1024) return toast.error("File is larger than 20 MB");
    setBusy(true);
    const path = `${profileId}/${Date.now().toString(36)}-${sanitizeFileName(file.name)}`;
    const up = await supabase.storage
      .from("employee-docs")
      .upload(path, file, { contentType: file.type });
    if (up.error) {
      setBusy(false);
      return toast.error(up.error.message);
    }
    const { error } = await supabase.from("employee_documents").insert({
      profile_id: profileId,
      kind,
      title: title.trim() || file.name,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      expires_at: expires || null,
      visible_to_employee: visible,
    });
    setBusy(false);
    if (error) {
      await supabase.storage.from("employee-docs").remove([path]);
      return toast.error(error.message);
    }
    toast.success("Document uploaded");
    void qc.invalidateQueries({ queryKey: ["documents", profileId] });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 text-sm hover:bg-muted/40"
          >
            <Upload className="h-4 w-4 text-muted-foreground" />
            {file
              ? `${file.name} · ${fmtBytes(file.size)}`
              : "Choose a PDF, image or Word file (max 20 MB)"}
          </button>
          <input
            ref={input}
            type="file"
            className="hidden"
            accept="application/pdf,image/*,.doc,.docx"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
            }}
          />
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DOC_KIND_LABEL).map(([k, l]) => (
                    <SelectItem key={k} value={k}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Expires (optional)</Label>
              <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </div>
          </div>
          {isAdmin && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={visible} onCheckedChange={(v) => setVisible(v === true)} />
              Visible to the employee
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !file}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
