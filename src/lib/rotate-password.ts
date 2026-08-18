import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { passwordStrength } from "@/lib/password-strength";

// Rotates a user's password server-side so the service-role key never reaches
// the browser. The caller's JWT is attached to the request automatically by
// the global attachSupabaseAuth middleware; only super admins may call this.
//
// Returns { ok: true } on success or { ok: false, error: string } on failure.
// We return errors instead of throwing because TanStack Start's Seroval
// serializer cannot handle Error objects.
export const rotateUserPassword = createServerFn({ method: "POST" })
  .validator((d: { userId: string; newPassword: string }) => d)
  .handler(async ({ data }) => {
    const authHeader = getRequest()?.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return { ok: false, error: "Unauthorized" } as const;

    // Loaded dynamically so the service-role module stays out of the client bundle.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const {
      data: { user: caller },
      error: callerError,
    } = await supabaseAdmin.auth.getUser(token);
    if (callerError || !caller) return { ok: false, error: "Unauthorized" } as const;

    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("auth_user_id", caller.id)
      .maybeSingle();
    if (callerProfile?.role !== "super_admin") {
      return { ok: false, error: "Only a super admin can rotate passwords." } as const;
    }

    const strength = passwordStrength(data.newPassword);
    if (strength.score < 4) {
      return {
        ok: false,
        error:
          "Password too weak — use at least 8 characters with upper and lower case, a number and a symbol.",
      } as const;
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.newPassword,
    });
    if (updateError) return { ok: false, error: updateError.message } as const;

    return { ok: true, error: null } as const;
  });
