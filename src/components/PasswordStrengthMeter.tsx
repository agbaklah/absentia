import { passwordStrength } from "@/lib/password-strength";
import { Check, ShieldAlert } from "lucide-react";

const BAR_COLORS = ["bg-red-500", "bg-orange-400", "bg-amber-400", "bg-lime-500", "bg-emerald-500"];

const LABEL_COLORS = [
  "text-red-600",
  "text-orange-500",
  "text-amber-600",
  "text-lime-600",
  "text-emerald-600",
];

export function PasswordStrengthMeter({ password }: { password: string }) {
  const { score, label, checks } = passwordStrength(password);
  const active = password.length > 0;

  return (
    <div id="password-strength" className="space-y-2">
      <div className="flex items-center gap-1.5" aria-hidden>
        {BAR_COLORS.map((color, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-200 ${
              active && i <= score ? color : "bg-muted"
            }`}
          />
        ))}
      </div>
      {active ? (
        <div className="space-y-1.5">
          <p
            aria-live="polite"
            className={`flex items-center gap-1.5 text-xs font-medium ${LABEL_COLORS[score]}`}
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            Password strength: {label}
          </p>
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {checks.map((c) => (
              <li
                key={c.label}
                className={`flex items-center gap-1.5 text-xs ${
                  c.met ? "text-emerald-600" : "text-muted-foreground"
                }`}
              >
                <span
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full ${
                    c.met ? "bg-emerald-600/15" : "bg-muted"
                  }`}
                >
                  <Check className={`h-2.5 w-2.5 ${c.met ? "" : "opacity-0"}`} />
                </span>
                {c.label}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Aim for at least 8 characters with a mix of cases, numbers and symbols.
        </p>
      )}
    </div>
  );
}
