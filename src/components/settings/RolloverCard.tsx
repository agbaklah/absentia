import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarRange, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { supabase } from "@/integrations/supabase/client";

type Preview = {
  processed: number;
  employees: {
    employee_id: string;
    name: string;
    entitlement: number;
    used: number;
    carry: number;
    lost: number;
  }[];
};

/** Year-end rollover: preview (dry run) then apply carry-over into next year. */
export function RolloverCard() {
  const qc = useQueryClient();
  const year = new Date().getFullYear();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"preview" | "run" | null>(null);
  const [confirm, setConfirm] = useState(false);

  const call = async (dry: boolean) => {
    setBusy(dry ? "preview" : "run");
    const { data, error } = await supabase.rpc("run_year_end_rollover", {
      _from_year: year,
      _dry_run: dry,
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    const p = data as unknown as Preview;
    if (dry) {
      setPreview(p);
      if (p.employees.length === 0) toast.info("Everyone has already been rolled over.");
    } else {
      toast.success(
        `Rolled over ${p.processed} employee${p.processed === 1 ? "" : "s"} into ${year + 1}`,
      );
      setPreview(null);
      void qc.invalidateQueries({ queryKey: ["allowances"] });
      void qc.invalidateQueries({ queryKey: ["balance-tx"] });
    }
  };

  const totals = preview?.employees.reduce(
    (t, e) => ({ carry: t.carry + Number(e.carry), lost: t.lost + Number(e.lost) }),
    { carry: 0, lost: 0 },
  );

  return (
    <Card className="card-dense p-5">
      <div className="mb-3 flex items-center gap-2">
        <CalendarRange className="h-4 w-4 text-emerald-700" />
        <div className="text-sm font-medium">
          Year-end rollover · {year} → {year + 1}
        </div>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Carries unused vacation into next year (capped by each policy), records what expires, and
        creates next year's allowances. Safe to re-run — employees already rolled over are skipped.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => call(true)} disabled={!!busy}>
          {busy === "preview" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Preview
        </Button>
        <Button
          size="sm"
          onClick={() => setConfirm(true)}
          disabled={!!busy || !preview || preview.employees.length === 0}
        >
          <Play className="h-3.5 w-3.5" />
          Run rollover
        </Button>
      </div>
      {preview && preview.employees.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-2 py-1.5">Employee</th>
                <th className="px-2 py-1.5 text-right">Entitled</th>
                <th className="px-2 py-1.5 text-right">Used</th>
                <th className="px-2 py-1.5 text-right">Carry</th>
                <th className="px-2 py-1.5 text-right">Expires</th>
              </tr>
            </thead>
            <tbody>
              {preview.employees.map((e) => (
                <tr key={e.employee_id} className="border-t">
                  <td className="px-2 py-1.5">{e.name}</td>
                  <td className="px-2 py-1.5 text-right tabular">{e.entitlement}</td>
                  <td className="px-2 py-1.5 text-right tabular">{e.used}</td>
                  <td className="px-2 py-1.5 text-right font-medium tabular text-emerald-700">
                    +{e.carry}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular text-muted-foreground">
                    {e.lost > 0 ? `−${e.lost}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot className="border-t bg-muted/30 font-medium">
                <tr>
                  <td className="px-2 py-1.5" colSpan={3}>
                    {preview.employees.length} employees
                  </td>
                  <td className="px-2 py-1.5 text-right tabular">+{totals.carry}</td>
                  <td className="px-2 py-1.5 text-right tabular">−{totals.lost}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Run the {year} → {year + 1} rollover?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This writes carry-over and expiry entries to every employee's balance history and
              creates their {year + 1} allowance. Usually done in the first week of January.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction onClick={() => void call(false)}>Run rollover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
