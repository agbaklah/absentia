/**
 * Company email policy — every account in the MIS must use the work domain.
 * Enforced client-side (forms) and server-side (DB trigger + CHECK constraint).
 */
export const WORK_EMAIL_DOMAIN = "verve-energyresources.com";

/**
 * True when `email` is a well-formed address ending in @verve-energyresources.com.
 * Case-insensitive; surrounding whitespace is ignored.
 */
export function isWorkEmail(email: string): boolean {
  return new RegExp(`^[^\\s@]+@${WORK_EMAIL_DOMAIN.replace(/\./g, "\\.")}$`, "i").test(
    email.trim(),
  );
}
