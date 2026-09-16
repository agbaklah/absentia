import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

type NagerHoliday = { date: string; localName: string; name: string; global: boolean };

/**
 * Import a country's public holidays from Nager.Date into `public_holidays`.
 * Runs server-side with the service role (the caller must be an admin) so the
 * browser never talks to a third-party API or bypasses RLS.
 *
 * Returns { ok, imported, error } — errors are returned, not thrown, because
 * Start's serializer can't carry Error objects.
 */
export const importPublicHolidays = createServerFn({ method: "POST" })
  .validator((d: { year: number; country: string; replaceOtherRegions?: boolean }) => d)
  .handler(async ({ data }) => {
    const authHeader = getRequest()?.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return { ok: false, imported: 0, error: "Unauthorized" } as const;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const {
      data: { user: caller },
      error: callerError,
    } = await supabaseAdmin.auth.getUser(token);
    if (callerError || !caller) return { ok: false, imported: 0, error: "Unauthorized" } as const;
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("auth_user_id", caller.id)
      .maybeSingle();
    if (prof?.role !== "admin" && prof?.role !== "super_admin")
      return { ok: false, imported: 0, error: "Only admins can import holidays." } as const;

    const country = data.country.trim().toUpperCase();
    const year = Math.trunc(data.year);
    if (!/^[A-Z]{2}$/.test(country) || year < 2000 || year > 2100)
      return { ok: false, imported: 0, error: "Invalid country or year." } as const;

    let list: NagerHoliday[];
    try {
      const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`, {
        headers: { accept: "application/json" },
      });
      if (res.status === 204 || res.status === 404)
        return {
          ok: false,
          imported: 0,
          error: `No holiday data for ${country} ${year}.`,
        } as const;
      if (!res.ok)
        return { ok: false, imported: 0, error: `Holiday service error (${res.status}).` } as const;
      list = (await res.json()) as NagerHoliday[];
    } catch (e) {
      return {
        ok: false,
        imported: 0,
        error: `Could not reach the holiday service: ${e instanceof Error ? e.message : String(e)}`,
      } as const;
    }

    // Nager can return the same date twice (regional variants); keep one per date.
    const byDate = new Map<string, string>();
    for (const h of list)
      if (h.global || !byDate.has(h.date)) byDate.set(h.date, h.localName || h.name);
    const rows = [...byDate].map(([date, name]) => ({ date, name, region: country }));
    if (rows.length === 0) return { ok: false, imported: 0, error: "Nothing to import." } as const;

    if (data.replaceOtherRegions) {
      const { error } = await supabaseAdmin
        .from("public_holidays")
        .delete()
        .gte("date", `${year}-01-01`)
        .lte("date", `${year}-12-31`)
        .neq("region", country);
      if (error) return { ok: false, imported: 0, error: error.message } as const;
    }
    const { error } = await supabaseAdmin
      .from("public_holidays")
      .upsert(rows, { onConflict: "date,region" });
    if (error) return { ok: false, imported: 0, error: error.message } as const;
    return { ok: true, imported: rows.length, error: null } as const;
  });
