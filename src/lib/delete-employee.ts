import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/**
 * Permanently deletes an employee: removes their auth user, profile row,
 * and all related leave_entries / leave_allowances.  Only callable by
 * super admins.
 */
export const deleteEmployee = createServerFn({ method: "POST" })
  .validator((d: { profileId: string }) => d)
  .handler(async ({ data }) => {
    const authHeader = getRequest()?.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return { error: "Unauthorized" } as const;

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    // --- caller auth check ---
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
    if (callerProfile?.role !== "super_admin") {
      return { error: "Only a super admin can delete employees." } as const;
    }

    // --- fetch profile ---
    const { data: profile, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, auth_user_id, role")
      .eq("id", data.profileId)
      .maybeSingle();
    if (profErr || !profile) return { error: "Employee not found." } as const;
    if (profile.role === "super_admin") {
      return { error: "Cannot delete a super admin account." } as const;
    }

    // --- delete related data ---
    await supabaseAdmin.from("leave_entries").delete().eq("employee_id", data.profileId);
    await supabaseAdmin.from("leave_allowances").delete().eq("employee_id", data.profileId);

    // --- delete profile row ---
    const { error: delErr } = await supabaseAdmin
      .from("profiles")
      .delete()
      .eq("id", data.profileId);
    if (delErr) return { error: `Profile delete failed: ${delErr.message}` } as const;

    // --- delete auth user (best-effort; profile is already gone) ---
    if (profile.auth_user_id) {
      const { error: authDelErr } = await supabaseAdmin.auth.admin.deleteUser(
        profile.auth_user_id,
      );
      if (authDelErr) {
        console.warn(
          `[delete-employee] Auth user delete failed for ${data.profileId}:`,
          authDelErr.message,
        );
      }
    }

    return { error: null } as const;
  });
