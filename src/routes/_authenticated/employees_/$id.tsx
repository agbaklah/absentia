import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { EmployeeProfile } from "@/components/people/EmployeeProfile";
import { useAuth } from "@/lib/auth-context";
import { useAllProfiles, useEmployees } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/employees_/$id")({
  component: EmployeeRecordPage,
});

/** Full record for one employee (management). */
function EmployeeRecordPage() {
  const { id } = Route.useParams();
  const { loading, isManagement, isAdmin, profile } = useAuth();
  const employees = useEmployees();
  const all = useAllProfiles({ enabled: isAdmin });
  const employee =
    (all.data ?? []).find((e) => e.id === id) ??
    (employees.data ?? []).find((e) => e.id === id) ??
    null;

  if (loading) return null;
  if (!isManagement) return <Navigate to="/profile" />;

  return (
    <div className="space-y-4">
      <PageHeader title={employee?.full_name ?? "Employee"} description="Employee record">
        <Button asChild variant="outline" size="sm">
          <Link to="/employees" search={{ q: "", view: "" }}>
            <ArrowLeft className="h-3.5 w-3.5" />
            All employees
          </Link>
        </Button>
      </PageHeader>
      {employee ? (
        <EmployeeProfile employee={employee} self={employee.id === profile?.id} />
      ) : employees.isLoading || all.isLoading ? null : (
        <div className="text-sm text-muted-foreground">Employee not found.</div>
      )}
    </div>
  );
}
