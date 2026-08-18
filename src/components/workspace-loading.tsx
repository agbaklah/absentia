import { RefreshCw } from "lucide-react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";

export function RefreshWorkspaceButton() {
  const queryClient = useQueryClient();
  const isFetching = useIsFetching() > 0;
  const [isPending, startTransition] = useTransition();
  const refreshing = isFetching || isPending;

  const refresh = () => {
    startTransition(() => {
      void queryClient.invalidateQueries({ refetchType: "active" });
    });
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={refresh}
      disabled={refreshing}
      aria-label={refreshing ? "Refreshing workspace" : "Refresh workspace"}
      title={refreshing ? "Refreshing…" : "Refresh workspace"}
      className="relative"
    >
      <RefreshCw
        className={`h-4 w-4 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`}
      />
      <span className="sr-only" aria-live="polite">
        {refreshing ? "Refreshing workspace" : ""}
      </span>
    </Button>
  );
}

export function WorkspaceLoadingOverlay() {
  const isFirstLoad =
    useIsFetching({
      predicate: (query) => query.state.data === undefined,
    }) > 0;

  if (!isFirstLoad) return null;

  return (
    <div
      className="absolute inset-0 z-20 bg-background/90 px-6 py-6 backdrop-blur-[1px] motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
      aria-live="polite"
      aria-label="Loading workspace content"
    >
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="space-y-2">
          <div className="h-7 w-40 rounded-md bg-muted animate-pulse motion-reduce:animate-none" />
          <div className="h-4 w-72 max-w-full rounded-md bg-muted/80 animate-pulse motion-reduce:animate-none" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {["one", "two", "three", "four"].map((key) => (
            <div key={key} className="h-24 rounded-lg border bg-card p-4">
              <div className="h-3 w-2/3 rounded bg-muted animate-pulse motion-reduce:animate-none" />
              <div className="mt-4 h-6 w-1/3 rounded bg-muted animate-pulse motion-reduce:animate-none" />
            </div>
          ))}
        </div>
        <div className="h-72 rounded-lg border bg-card p-4">
          <div className="h-4 w-44 rounded bg-muted animate-pulse motion-reduce:animate-none" />
          <div className="mt-6 h-52 rounded bg-muted/60 animate-pulse motion-reduce:animate-none" />
        </div>
      </div>
      <p className="sr-only">Loading workspace content</p>
    </div>
  );
}
