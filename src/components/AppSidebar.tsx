import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Calendar,
  ClipboardList,
  BarChart3,
  Users,
  Settings,
  LogOut,
} from "lucide-react";
import { SperoLogo } from "@/components/SperoLogo";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth-context";
import { useEntries } from "@/lib/data";
import { pendingRequestCount } from "@/lib/requests-util";
import { Button } from "@/components/ui/button";
import { InitialsAvatar } from "@/components/InitialsAvatar";

const managementItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Calendar", url: "/calendar", icon: Calendar },
  { title: "Requests", url: "/requests", icon: ClipboardList },
  { title: "Yearly Summary", url: "/yearly", icon: BarChart3 },
  { title: "Employees", url: "/employees", icon: Users },
  { title: "Settings", url: "/settings", icon: Settings },
];

const employeeItems = [
  { title: "My Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "My Requests", url: "/requests", icon: ClipboardList },
];

const roleLabel: Record<string, string> = {
  admin: "Administrator",
  manager: "Manager",
  employee: "Employee",
  super_admin: "Super Administrator",
};

export function AppSidebar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { profile, signOut, isManagement } = useAuth();
  const items = isManagement ? managementItems : employeeItems;
  // Pending requests needing attention: org-wide for management, own for employees.
  const entries = useEntries(new Date().getFullYear());
  const scopeId = isManagement ? undefined : profile?.id;
  const pendingCount =
    !isManagement && !scopeId ? 0 : pendingRequestCount(entries.data ?? [], scopeId);
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm">
            <SperoLogo size={28} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight">SPERO MIS</div>
            <div className="truncate text-[11px] text-sidebar-foreground/60">Leave & Absence</div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{isManagement ? "Management" : "Workspace"}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((it) => (
                <SidebarMenuItem key={it.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={path === it.url || path.startsWith(it.url + "/")}
                  >
                    <Link to={it.url}>
                      <it.icon className="h-4 w-4" />
                      <span>{it.title}</span>
                      {it.url === "/requests" && pendingCount > 0 && (
                        <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400 px-1.5 text-[11px] font-bold leading-none text-amber-950">
                          {pendingCount}
                        </span>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-2.5 rounded-lg bg-sidebar-accent/60 px-2 py-2">
          <InitialsAvatar
            name={profile?.full_name ?? "User"}
            className="h-8 w-8 shrink-0 ring-2 ring-sidebar-border"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{profile?.full_name ?? "Signed in"}</div>
            <div className="truncate text-[10px] uppercase tracking-wide text-sidebar-foreground/60">
              {roleLabel[profile?.role ?? "employee"] ?? "Employee"}
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => void signOut()}
            className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <LogOut className="h-4 w-4" />
            <span className="sr-only">Sign out</span>
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
