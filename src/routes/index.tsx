import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Absentia — Leave & Absence Management" },
      { name: "description", content: "Track staff absence, approvals, and vacation allowances across your organisation." },
      { property: "og:title", content: "Absentia — Leave & Absence Management" },
      { property: "og:description", content: "Track staff absence, approvals, and vacation allowances across your organisation." },
    ],
  }),
  component: Index,
});

function Index() {
  const { loading, session } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  return <Navigate to={session ? "/dashboard" : "/auth"} />;
}
