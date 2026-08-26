import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

// ---------------------------------------------------------------------------
// Helper: extract and verify the caller's JWT + role
// ---------------------------------------------------------------------------

type CallerCtx = { profileId: string; role: string };

async function getCallerAuth(): Promise<CallerCtx | { error: string }> {
  const authHeader = getRequest()?.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return { error: "Unauthorized" };

  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );

  const {
    data: { user: caller },
    error: callerError,
  } = await supabaseAdmin.auth.getUser(token);
  if (callerError || !caller) return { error: "Unauthorized" };

  const { data: callerProfile, error: callerProfileError } =
    await supabaseAdmin
      .from("profiles")
      .select("id, role")
      .eq("auth_user_id", caller.id)
      .maybeSingle();
  if (callerProfileError || !callerProfile) return { error: "Unauthorized" };

  return { profileId: callerProfile.id, role: callerProfile.role };
}

// ---------------------------------------------------------------------------
// Soft-delete (archive) an employee
// Only admins and super_admins can archive; cannot archive super_admins.
// ---------------------------------------------------------------------------

export const softDeleteEmployee = createServerFn({ method: "POST" })
  .validator((d: { profileId: string }) => d)
  .handler(async ({ data }) => {
    const auth = await getCallerAuth();
    if ("error" in auth) return { error: auth.error } as const;

    if (auth.role !== "admin" && auth.role !== "super_admin") {
      return { error: "Only admins can archive employees." } as const;
    }

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: target, error: targetErr } = await supabaseAdmin
      .from("profiles")
      .select("id, role")
      .eq("id", data.profileId)
      .maybeSingle();
    if (targetErr || !target) return { error: "Employee not found." } as const;

    // Admins cannot archive other admins/super_admins
    if (
      auth.role === "admin" &&
      (target.role === "admin" || target.role === "super_admin")
    ) {
      return {
        error: "You do not have permission to archive this user.",
      } as const;
    }

    // Super admins cannot archive other super admins
    if (auth.role === "super_admin" && target.role === "super_admin") {
      return { error: "Cannot archive a super admin account." } as const;
    }

    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({ active: false })
      .eq("id", data.profileId);
    if (updateErr) return { error: updateErr.message } as const;

    // Audit log
    await supabaseAdmin.from("audit_log").insert({
      actor_id: auth.profileId,
      action: "employee_archived",
      entity: "profile",
      entity_id: data.profileId,
      after: { archived_by: auth.role },
    });

    return { error: null } as const;
  });

// ---------------------------------------------------------------------------
// Change an employee's role
// Only super_admins can assign admin/super_admin roles.
// Admins can assign employee/manager roles.
// ---------------------------------------------------------------------------

const VALID_ROLES = ["employee", "manager", "admin", "super_admin"] as const;

export const changeEmployeeRole = createServerFn({ method: "POST" })
  .validator((d: { profileId: string; role: string }) => d)
  .handler(async ({ data }) => {
    if (!VALID_ROLES.includes(data.role as (typeof VALID_ROLES)[number])) {
      return { error: "Invalid role." } as const;
    }

    const auth = await getCallerAuth();
    if ("error" in auth) return { error: auth.error } as const;

    if (auth.role !== "admin" && auth.role !== "super_admin") {
      return { error: "Only admins can change roles." } as const;
    }

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: target, error: targetErr } = await supabaseAdmin
      .from("profiles")
      .select("id, role")
      .eq("id", data.profileId)
      .maybeSingle();
    if (targetErr || !target) return { error: "Employee not found." } as const;

    // Admins can only assign employee/manager roles
    if (
      auth.role === "admin" &&
      (data.role === "admin" || data.role === "super_admin")
    ) {
      return {
        error: "Only super admins can assign admin roles.",
      } as const;
    }

    // Non-super-admins cannot change admin/super_admin roles
    if (
      auth.role === "admin" &&
      (target.role === "admin" || target.role === "super_admin")
    ) {
      return {
        error: "You do not have permission to change this user's role.",
      } as const;
    }

    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({ role: data.role as "admin" | "manager" | "employee" | "super_admin" })
      .eq("id", data.profileId);
    if (updateErr) return { error: updateErr.message } as const;

    // Audit log
    await supabaseAdmin.from("audit_log").insert({
      actor_id: auth.profileId,
      action: "role_changed",
      entity: "profile",
      entity_id: data.profileId,
      before: { role: target.role },
      after: { role: data.role },
    });

    return { error: null } as const;
  });

// ---------------------------------------------------------------------------
// Change an employee's team assignment
// Only admins can reassign teams.
// ---------------------------------------------------------------------------

export const changeEmployeeTeam = createServerFn({ method: "POST" })
  .validator((d: { profileId: string; teamId: string | null }) => d)
  .handler(async ({ data }) => {
    const auth = await getCallerAuth();
    if ("error" in auth) return { error: auth.error } as const;

    if (auth.role !== "admin" && auth.role !== "super_admin") {
      return { error: "Only admins can reassign teams." } as const;
    }

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    // Verify target exists
    const { data: target, error: targetErr } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("id", data.profileId)
      .maybeSingle();
    if (targetErr || !target) return { error: "Employee not found." } as const;

    // Verify team exists (if not null)
    if (data.teamId) {
      const { data: team, error: teamErr } = await supabaseAdmin
        .from("teams")
        .select("id")
        .eq("id", data.teamId)
        .maybeSingle();
      if (teamErr || !team) return { error: "Team not found." } as const;
    }

    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({ team_id: data.teamId })
      .eq("id", data.profileId);
    if (updateErr) return { error: updateErr.message } as const;

    return { error: null } as const;
  });
