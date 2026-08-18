import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  Calendar,
  ClipboardList,
  BarChart3,
  Users,
  Settings,
  Search,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useEmployees } from "@/lib/data";

const roleLabel: Record<string, string> = {
  employee: "Employee",
  manager: "Manager",
  admin: "Admin",
  super_admin: "Super Admin",
};

const ALL_PAGES = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, mgmt: true, emp: true },
  { title: "Calendar", url: "/calendar", icon: Calendar, mgmt: true, emp: false },
  { title: "Leave requests", url: "/requests", icon: ClipboardList, mgmt: true, emp: true },
  { title: "Yearly summary", url: "/yearly", icon: BarChart3, mgmt: true, emp: false },
  { title: "Employees", url: "/employees", icon: Users, mgmt: true, emp: false },
  { title: "Settings", url: "/settings", icon: Settings, mgmt: true, emp: false },
];

/** ⌘K / Ctrl-K navigator: jump to any page or open an employee's calendar. */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const nav = useNavigate();
  const { isManagement } = useAuth();
  const employees = useEmployees({ enabled: isManagement });

  const pages = useMemo(
    () => ALL_PAGES.filter((p) => (isManagement ? p.mgmt : p.emp)),
    [isManagement],
  );

  // Global keyboard shortcut: ⌘K / Ctrl-K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages, employees…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Pages">
          {pages.map((p) => (
            <CommandItem
              key={p.url}
              value={p.title}
              onSelect={() => {
                onOpenChange(false);
                nav({ to: p.url });
              }}
            >
              <p.icon className="h-4 w-4" />
              <span>{p.title}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        {isManagement && (employees.data ?? []).length > 0 && (
          <CommandGroup heading="Employees">
            {(employees.data ?? []).slice(0, 12).map((e) => (
              <CommandItem
                key={e.id}
                value={e.full_name + " " + e.email}
                onSelect={() => {
                  onOpenChange(false);
                  nav({ to: "/employees", search: { q: e.full_name, view: e.id } });
                }}
              >
                <Search className="h-4 w-4" />
                <span>{e.full_name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {roleLabel[e.role] ?? e.role}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
