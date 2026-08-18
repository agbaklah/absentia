/**
 * Turns raw Supabase/GoTrue error messages into friendly, actionable copy.
 * Unknown messages pass through unchanged so we never hide a real error.
 */
export function authErrorMessage(message: string): string {
  if (typeof message !== "string") return "";
  const m = message.trim();
  if (/rate\s?limit|over_[a-z_]*rate|too many (requests|attempts)/i.test(m)) {
    return (
      "Too many auth attempts from this device — Supabase limits sign-ups to 30 per hour. " +
      "Wait about an hour and try again, or raise the limits in the Supabase dashboard " +
      "(Authentication → Rate Limits)."
    );
  }
  return message;
}
