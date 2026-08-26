import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/**
 * Employee completes the mandatory password change after receiving an
 * admin-generated temporary password.
 *
 * Validates:
 *   - New password meets complexity policy
 *   - New password is not the same as the temporary password
 *   - Temporary password has not expired
 *
 * On success:
 *   - Clears force_password_change, temp_password_hash, temp_password_expires_at
 *   - Updates password_changed_at
 *   - Signs out all sessions for the user (session rotation)
 *   - Returns status: "reauthenticate" so the client redirects to sign-in
 */
export const completePasswordChange = createServerFn({ method: "POST" })
  .validator((d: { newPassword: string }) => d)
  .handler(async ({ data }) => {
    // --- caller auth ---
    const authHeader = getRequest()?.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return { error: "Unauthorized" } as const;

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const {
      data: { user: caller },
      error: callerError,
    } = await supabaseAdmin.auth.getUser(token);
    if (callerError || !caller) return { error: "Unauthorized" } as const;

    // --- password complexity (must match existing policy: score 4 / "Strong") ---
    const strength = passwordStrength(data.newPassword);
    if (strength.score < 4) {
      return {
        error:
          "Password too weak — use at least 8 characters with upper and lower case, a number and a symbol.",
      } as const;
    }

    // --- look up profile ---
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select(
        "id, force_password_change, temp_password_hash, temp_password_expires_at",
      )
      .eq("auth_user_id", caller.id)
      .maybeSingle();
    if (profileErr || !profile) return { error: "Profile not found." } as const;

    // --- if the user has a temp password hash, enforce restrictions ---
    if (profile.force_password_change && profile.temp_password_hash) {
      // Check expiry
      if (
        profile.temp_password_expires_at &&
        new Date(profile.temp_password_expires_at) < new Date()
      ) {
        return {
          error:
            "This temporary password has expired. Please contact your administrator for a new one.",
        } as const;
      }

      // Prevent reuse: compare the new password against the stored temp hash
      const newHash = await sha256Hex(data.newPassword);
      if (compareHashes(newHash, profile.temp_password_hash)) {
        return {
          error:
            "You cannot reuse the temporary password as your permanent password.",
        } as const;
      }
    }

    // --- update password in Supabase Auth ---
    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(
      caller.id,
      { password: data.newPassword },
    );
    if (updateErr) {
      return {
        error: `Failed to update password: ${updateErr.message}`,
      } as const;
    }

    // --- clear temp state and update timestamp ---
    const now = new Date().toISOString();
    const { error: clearErr } = await supabaseAdmin
      .from("profiles")
      .update({
        force_password_change: false,
        temp_password_hash: null,
        temp_password_expires_at: null,
        password_changed_at: now,
      })
      .eq("id", profile.id);
    if (clearErr) {
      console.warn(
        "[completePasswordChange] Could not clear flags:",
        clearErr.message,
      );
    }

    // --- invalidate all sessions for this user (session rotation) ---
    // Signed-out sessions will fail token refresh; current JWTs expire shortly.
    try {
      await supabaseAdmin.auth.admin.signOut(caller.id);
    } catch {
      // Best-effort: if this fails, old tokens still expire naturally
      console.warn("[completePasswordChange] signOut failed (non-fatal)");
    }

    // --- audit log (no password in logs) ---
    await supabaseAdmin.from("audit_log").insert({
      actor_id: profile.id,
      action: "password_changed",
      entity: "profile",
      entity_id: profile.id,
      after: { method: "force_change_completed" },
    });

    // Client must re-authenticate to get a fresh session
    return { status: "reauthenticate" as const, error: null };
  });

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

// Inline password-strength check (same logic as @/lib/password-strength but
// inlined to avoid pulling UI code into a server function).
function passwordStrength(password: string): { score: number } {
  const checks: ((p: string) => boolean)[] = [
    (p) => p.length >= 8,
    (p) => /[A-Z]/.test(p),
    (p) => /[a-z]/.test(p),
    (p) => /\d/.test(p),
    (p) => /[^A-Za-z0-9]/.test(p),
  ];
  const met = checks.filter((fn) => fn(password)).length;
  const score = met <= 1 ? 0 : met === 2 ? 1 : met === 3 ? 2 : met === 4 ? 3 : 4;
  return { score };
}

/** SHA-256 → hex string. */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of two hex strings to prevent timing attacks. */
export function compareHashes(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
