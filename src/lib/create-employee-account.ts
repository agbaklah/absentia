import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/**
 * Creates a Supabase auth user for a pre-registered employee, sets a temp
 * password, and flags the profile so the user must change it on first login.
 *
 * Only callable by super admins (guarded by JWT check).
 *
 * Returns `{ tempPassword }` on success so the UI can display it.
 */
export const createEmployeeAccount = createServerFn({ method: "POST" })
  .validator(
    (d: { profileId: string; email: string; fullName: string }) => d,
  )
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
      return {
        error: "Only a super admin can create employee accounts.",
      } as const;
    }

    // --- check profile exists and has no auth user yet ---
    const { data: profile, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, auth_user_id")
      .eq("id", data.profileId)
      .maybeSingle();
    if (profErr || !profile) return { error: "Employee profile not found." } as const;
    if (profile.auth_user_id) {
      return { error: "This employee already has a login account." } as const;
    }

    // --- generate a strong temp password ---
    const tempPassword = generateTempPassword();

    // --- create auth user ---
    const { data: newUser, error: createErr } =
      await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: data.fullName },
      });
    if (createErr || !newUser?.user) {
      return { error: createErr?.message ?? "Failed to create auth user." } as const;
    }

    // --- link auth user to profile & force password change ---
    const { error: linkErr } = await supabaseAdmin
      .from("profiles")
      .update({
        auth_user_id: newUser.user.id,
        force_password_change: true,
      })
      .eq("id", data.profileId);
    if (linkErr) {
      return { error: `Auth created but profile link failed: ${linkErr.message}` } as const;
    }

    return { tempPassword, error: null } as const;
  });

/** Generate a 16-char password: upper + lower + digit + symbol, guaranteed. */
function generateTempPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*?";
  const all = upper + lower + digits + symbols;

  // Guarantee at least one from each class
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];

  for (let i = chars.length; i < 16; i++) {
    chars.push(all[Math.floor(Math.random() * all.length)]);
  }

  // Shuffle (Fisher-Yates)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
