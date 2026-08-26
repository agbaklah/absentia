import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/**
 * Admin-initiated password reset.  Generates a cryptographically secure
 * temporary password, stores only its SHA-256 hash + expiry on the profile,
 * sets the password in Supabase Auth, and returns the plaintext password
 * exactly once in the response.
 *
 * Authorization (server-side):
 *   - SUPERADMIN can reset any user, including ADMIN.
 *   - ADMIN can reset EMPLOYEE (and MANAGER) users only.
 *   - Nobody can reset themselves.
 */
export const resetEmployeePassword = createServerFn({ method: "POST" })
  .validator((d: { profileId: string }) => d)
  .handler(async ({ data }) => {
    // --- caller auth ---
    const authHeader = getRequest()?.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return { error: "Unauthorized" } as const;

    // Loaded dynamically so the service-role module stays out of the client bundle.
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const {
      data: { user: caller },
      error: callerError,
    } = await supabaseAdmin.auth.getUser(token);
    if (callerError || !caller) return { error: "Unauthorized" } as const;

    // Look up caller profile
    const { data: callerProfile, error: callerProfileError } =
      await supabaseAdmin
        .from("profiles")
        .select("id, role")
        .eq("auth_user_id", caller.id)
        .maybeSingle();
    if (callerProfileError || !callerProfile)
      return { error: "Unauthorized" } as const;

    const callerRole = callerProfile.role;

    // --- fetch target profile ---
    const { data: target, error: targetErr } = await supabaseAdmin
      .from("profiles")
      .select("id, auth_user_id, role, full_name, email")
      .eq("id", data.profileId)
      .maybeSingle();
    if (targetErr || !target) return { error: "Employee not found." } as const;
    if (!target.auth_user_id) {
      return {
        error: "This employee does not have a login account.",
      } as const;
    }

    // --- authorization checks ---
    if (target.id === callerProfile.id) {
      return { error: "You cannot reset your own password." } as const;
    }

    if (callerRole === "super_admin") {
      // Super admin can reset anyone — no further checks needed.
    } else if (callerRole === "admin") {
      // Admin can reset employees (and managers) but not other admins or super admins.
      if (target.role === "admin" || target.role === "super_admin") {
        return {
          error: "You do not have permission to reset this user's password.",
        } as const;
      }
    } else {
      return {
        error: "You do not have permission to reset passwords.",
      } as const;
    }

    // --- generate temporary password ---
    const tempPassword = generateTempPassword();

    // --- hash for storage (SHA-256 hex) ---
    const tempHash = await sha256Hex(tempPassword);

    // --- expiry: 72 hours from now ---
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

    // --- set password in Supabase Auth (via admin API) ---
    const { error: updateErr } =
      await supabaseAdmin.auth.admin.updateUserById(target.auth_user_id, {
        password: tempPassword,
      });
    if (updateErr) {
      return { error: `Failed to update password: ${updateErr.message}` } as const;
    }

    // --- update profile: store hash, expiry, force password change ---
    const now = new Date().toISOString();
    const { error: profileErr } = await supabaseAdmin
      .from("profiles")
      .update({
        force_password_change: true,
        temp_password_hash: tempHash,
        temp_password_expires_at: expiresAt,
        password_changed_at: now,
      })
      .eq("id", data.profileId);
    if (profileErr) {
      return {
        error: `Password set but profile update failed: ${profileErr.message}`,
      } as const;
    }

    // --- audit log (no plaintext password logged) ---
    await supabaseAdmin.from("audit_log").insert({
      actor_id: callerProfile.id,
      action: "password_reset",
      entity: "profile",
      entity_id: data.profileId,
      after: { method: "admin_generated_temp" },
    });

    return { tempPassword, error: null } as const;
  });

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Generate a 16-character temporary password using the Web Crypto API.
 *
 * Uses an unambiguous character set — excludes visually confusing characters
 * (0, O, o, 1, l, I).  Guarantees at least one character from each class
 * (upper, lower, digit, symbol) to satisfy the portal's password policy.
 */
export function generateTempPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*?";
  const all = upper + lower + digits + symbols;

  const secureRandom = (max: number): number => {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return arr[0] % max;
  };

  // Guarantee at least one from each class
  const pick = (set: string) => set[secureRandom(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];

  for (let i = chars.length; i < 16; i++) {
    chars.push(all[secureRandom(all.length)]);
  }

  // Fisher-Yates shuffle using secure randomness
  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureRandom(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join("");
}

/** SHA-256 → hex string (constant-time comparison done separately). */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Constant-time comparison of two hex-encoded hashes to prevent timing attacks.
 * Used when comparing the stored temp password hash against the one derived from
 * the password the employee provides during mandatory change.
 */
export function compareHashes(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/** 72-hour expiry in hours (exported for tests). */
export const TEMP_PASSWORD_EXPIRY_HOURS = 72;
