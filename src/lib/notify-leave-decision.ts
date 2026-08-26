import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/**
 * Notify an employee by email when their leave request is approved or rejected.
 * Called from the client after a successful approve/reject action.
 */
export const notifyLeaveDecision = createServerFn({ method: "POST" })
  .validator(
    (d: {
      employeeId: string;
      status: "approved" | "rejected";
      leaveType: string;
      dates: string;
      decisionNote?: string | null;
    }) => d,
  )
  .handler(async ({ data }) => {
    const authHeader = getRequest()?.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return { error: "Unauthorized" } as const;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verify caller is management (admin, manager, or super_admin)
    const {
      data: { user: caller },
      error: callerError,
    } = await supabaseAdmin.auth.getUser(token);
    if (callerError || !caller) return { error: "Unauthorized" } as const;

    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("auth_user_id", caller.id)
      .maybeSingle();
    if (
      !callerProfile ||
      (callerProfile.role !== "admin" &&
        callerProfile.role !== "manager" &&
        callerProfile.role !== "super_admin")
    ) {
      return { error: "Unauthorized" } as const;
    }

    // Look up the employee's email and name
    const { data: employee, error: empErr } = await supabaseAdmin
      .from("profiles")
      .select("email, full_name")
      .eq("id", data.employeeId)
      .maybeSingle();
    if (empErr || !employee) return { error: "Employee not found" } as const;

    // Import and send the email
    const { sendLeaveDecisionEmail } = await import("@/lib/send-leave-email");
    await sendLeaveDecisionEmail({
      to: employee.email,
      employeeName: employee.full_name,
      status: data.status,
      leaveType: data.leaveType,
      dates: data.dates,
      decisionNote: data.decisionNote,
    });

    return { error: null } as const;
  });
