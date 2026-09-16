import { useEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useNotifications, type NotificationRow } from "@/lib/data";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/relative-time";

export function NotificationBell() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const notifications = useNotifications({ enabled: !!profile });
  const items = useMemo(() => notifications.data ?? [], [notifications.data]);
  const unread = useMemo(() => items.filter((n) => !n.read_at).length, [items]);

  // Live updates: refetch + toast when a new notification lands for me.
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`notifications:${profile.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${profile.id}`,
        },
        (payload) => {
          const n = payload.new as NotificationRow;
          toast(n.title, { description: n.body ?? undefined });
          void qc.invalidateQueries({ queryKey: ["notifications"] });
          // Whatever changed probably affects a list the user is looking at.
          void qc.invalidateQueries({ queryKey: ["claims"] });
          void qc.invalidateQueries({ queryKey: ["entries"] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profile?.id, qc]);

  const markRead = async (ids: string[]) => {
    if (ids.length === 0) return;
    qc.setQueryData<NotificationRow[]>(["notifications"], (old) =>
      (old ?? []).map((n) =>
        ids.includes(n.id) ? { ...n, read_at: new Date().toISOString() } : n,
      ),
    );
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .in("id", ids);
    if (error) toast.error(error.message);
    void qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  const open = async (n: NotificationRow) => {
    if (!n.read_at) void markRead([n.id]);
    // Links are stored as plain paths (e.g. "/expenses/review"), not typed routes.
    if (n.link) void nav({ href: n.link });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold leading-none text-amber-950">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="text-sm font-medium">Notifications</div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            disabled={unread === 0}
            onClick={() => markRead(items.filter((n) => !n.read_at).map((n) => n.id))}
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark all read
          </Button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              You're all caught up.
            </div>
          )}
          {items.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => open(n)}
              className={cn(
                "flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left text-sm transition-colors last:border-b-0 hover:bg-muted/50",
                !n.read_at && "bg-primary/5",
              )}
            >
              <span
                className={cn(
                  "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                  n.read_at ? "bg-transparent" : "bg-primary",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className={cn("truncate", !n.read_at && "font-medium")}>{n.title}</div>
                {n.body && <div className="truncate text-xs text-muted-foreground">{n.body}</div>}
              </div>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {relativeTime(n.created_at)}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
