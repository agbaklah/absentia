import { createFileRoute, Outlet, Navigate, useRouterState } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useAuth } from "@/lib/auth-context";
import { RefreshWorkspaceButton, WorkspaceLoadingOverlay } from "@/components/workspace-loading";
import { CommandPalette } from "@/components/CommandPalette";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedLayout,
});

const TITLES: Record<string, { label: string; sub?: string }> = {
  "/dashboard": { label: "Dashboard" },
  "/calendar": { label: "Calendar" },
  "/requests": { label: "Requests" },
  "/yearly": { label: "Yearly summary" },
  "/employees": { label: "Employees" },
  "/settings": { label: "Settings" },
};

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function AuthenticatedLayout() {
  const { loading, session } = useAuth();
  if (loading) return <InitialAppLoadingScreen />;
  if (!session) return <Navigate to="/auth" />;
  return <Shell />;
}

function Shell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const now = useNow();
  const title = TITLES[path]?.label ?? "Workspace";

  const dateStr = now.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <SidebarInset>
          <header className="h-14 flex items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sticky top-0 z-30">
            <SidebarTrigger />
            <div className="hidden sm:block text-sm font-medium">{title}</div>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto hidden h-8 w-56 justify-start gap-2 text-muted-foreground md:inline-flex"
              onClick={() => setPaletteOpen(true)}
            >
              <Search className="h-3.5 w-3.5" />
              <span>Search…</span>
              <kbd className="ml-auto rounded border bg-muted px-1.5 text-[10px] font-medium">
                ⌘K
              </kbd>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="md:hidden"
              onClick={() => setPaletteOpen(true)}
              aria-label="Search"
            >
              <Search className="h-4 w-4" />
            </Button>
            <span className="hidden text-xs text-muted-foreground lg:inline">{dateStr}</span>
            <RefreshWorkspaceButton />
          </header>
          <main className="relative flex-1 overflow-hidden bg-background p-6">
            <Outlet />
            <WorkspaceLoadingOverlay />
          </main>
        </SidebarInset>
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      </div>
    </SidebarProvider>
  );
}

function InitialAppLoadingScreen() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background p-6"
      aria-live="polite"
    >
      <div className="w-full max-w-md space-y-5">
        <div className="mx-auto h-10 w-10 rounded-lg bg-primary/15 animate-pulse motion-reduce:animate-none" />
        <div className="space-y-2 text-center">
          <div className="mx-auto h-5 w-28 rounded bg-muted animate-pulse motion-reduce:animate-none" />
          <div className="mx-auto h-4 w-52 rounded bg-muted/80 animate-pulse motion-reduce:animate-none" />
        </div>
        <div className="h-28 rounded-lg border bg-card p-4">
          <div className="h-3 w-1/2 rounded bg-muted animate-pulse motion-reduce:animate-none" />
          <div className="mt-4 h-8 rounded bg-muted/70 animate-pulse motion-reduce:animate-none" />
        </div>
        <span className="sr-only">Loading SPERO Internal MIS</span>
      </div>
    </div>
  );
}
