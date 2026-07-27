import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Calendar, ClipboardList, BarChart3, Users, Settings, LogOut, Trees,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";

const items = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Calendar", url: "/calendar", icon: Calendar },
  { title: "Requests", url: "/requests", icon: ClipboardList },
  { title: "Yearly Summary", url: "/yearly", icon: BarChart3 },
  { title: "Employees", url: "/employees", icon: Users },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { profile, signOut } = useAuth();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <Trees className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Absentia</div>
            <div className="truncate text-[11px] text-sidebar-foreground/60">Leave & Absence</div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((it) => (
                <SidebarMenuItem key={it.url}>
                  <SidebarMenuButton asChild isActive={path === it.url || path.startsWith(it.url + "/")}>
                    <Link to={it.url}>
                      <it.icon className="h-4 w-4" />
                      <span>{it.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-2 px-2 py-2 text-sidebar-foreground">
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{profile?.full_name ?? "Signed in"}</div>
            <div className="truncate text-[11px] uppercase tracking-wide text-sidebar-foreground/60">
              {profile?.role ?? "employee"}
            </div>
          </div>
          <Button size="icon" variant="ghost" onClick={() => void signOut()} className="text-sidebar-foreground hover:bg-sidebar-accent">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}