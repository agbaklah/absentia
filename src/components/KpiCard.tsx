import { Card } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * KPI stat card with an icon chip, big tabular value, and optional accent tone.
 * Used on both the admin and employee dashboards.
 */
export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "primary",
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: "primary" | "accent" | "danger" | "info" | "neutral";
  className?: string;
}) {
  const tones: Record<string, string> = {
    primary: "bg-emerald-600/10 text-emerald-700",
    accent: "bg-amber-600/10 text-amber-700",
    danger: "bg-red-600/10 text-red-700",
    info: "bg-sky-600/10 text-sky-700",
    neutral: "bg-slate-500/10 text-slate-600",
  };
  return (
    <Card className="card-dense group relative overflow-hidden p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div className="tabular mt-2 font-display text-2xl font-semibold leading-none tracking-tight">
            {value}
          </div>
          {hint && <div className="mt-1.5 truncate text-xs text-muted-foreground">{hint}</div>}
        </div>
        {Icon && (
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-transform group-hover:scale-105",
              tones[tone],
            )}
          >
            <Icon className="h-4.5 w-4.5" />
          </span>
        )}
      </div>
    </Card>
  );
}
