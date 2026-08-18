import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const COLOURS = [
  "bg-emerald-600",
  "bg-amber-600",
  "bg-sky-600",
  "bg-violet-600",
  "bg-rose-600",
  "bg-teal-600",
  "bg-indigo-600",
  "bg-orange-600",
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/** Deterministic initials avatar — same name always maps to the same colour. */
export function InitialsAvatar({
  name,
  className,
  fallbackClassName,
}: {
  name: string;
  className?: string;
  fallbackClassName?: string;
}) {
  return (
    <Avatar className={cn("h-8 w-8 text-xs", className)}>
      <AvatarFallback
        className={cn(
          COLOURS[hash(name) % COLOURS.length],
          "font-semibold text-white",
          fallbackClassName,
        )}
      >
        {initialsOf(name) || "?"}
      </AvatarFallback>
    </Avatar>
  );
}
