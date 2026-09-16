import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { EmployeeProfile } from "@/components/people/EmployeeProfile";
import { useAuth } from "@/lib/auth-context";
import { useEmployees } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/profile")({
  component: MyProfilePage,
});

/** The signed-in user's own record. */
function MyProfilePage() {
  const { profile } = useAuth();
  const employees = useEmployees();
  const me = (employees.data ?? []).find((e) => e.id === profile?.id) ?? null;
  return (
    <div className="space-y-4">
      <PageHeader
        title="My profile"
        description="Your details, documents and payout information."
      />
      {me ? <EmployeeProfile employee={me} self /> : null}
    </div>
  );
}
