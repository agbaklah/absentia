import { createServerFn } from "@tanstack/react-start";

/**
 * Sends email notifications to all active admins / super admins when a leave
 * request is submitted.  Uses the Resend API if a RESEND_API_KEY env var is
 * set; otherwise falls back to console logging so the app still works in dev.
 *
 * Called from the client after a successful leave_entries insert.
 */
export const notifyAdminsOnRequest = createServerFn({ method: "POST" })
  .validator(
    (d: {
      employeeName: string;
      employeeEmail: string;
      leaveType: string;
      startDate: string;
      endDate: string;
      dayCount: number;
      note?: string;
    }) => d,
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    // Fetch active admins + super admins
    const { data: admins, error: adminErr } = await supabaseAdmin
      .from("profiles")
      .select("email, full_name")
      .in("role", ["admin", "super_admin"])
      .eq("active", true)
      .neq("email", data.employeeEmail);

    if (adminErr || !admins || admins.length === 0) {
      console.warn(
        "[notify-admins] Could not fetch admin list:",
        adminErr?.message ?? "none found",
      );
      return { sent: 0 } as const;
    }

    const subject = `New leave request from ${data.employeeName}`;
    const dayWord = data.dayCount === 1 ? "day" : "days";
    const body = [
      `<p><strong>${data.employeeName}</strong> (${data.employeeEmail}) has submitted a leave request.</p>`,
      `<table style="border-collapse:collapse;margin:12px 0">`,
      `<tr><td style="padding:4px 12px 4px 0;color:#666">Leave type</td><td style="padding:4px 0"><strong>${data.leaveType}</strong></td></tr>`,
      `<tr><td style="padding:4px 12px 4px 0;color:#666">Dates</td><td style="padding:4px 0">${data.startDate} → ${data.endDate}</td></tr>`,
      `<tr><td style="padding:4px 12px 4px 0;color:#666">Duration</td><td style="padding:4px 0">${data.dayCount} working ${dayWord}</td></tr>`,
      data.note
        ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Reason</td><td style="padding:4px 0">${data.note}</td></tr>`
        : "",
      `</table>`,
      `<p style="color:#888;font-size:12px">Log in to SPERO Internal MIS to approve or reject this request.</p>`,
    ]
      .filter(Boolean)
      .join("\n");

    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail =
      process.env.EMAIL_FROM || "SPERO MIS <notifications@verve-energyresources.com>";

    if (!apiKey) {
      console.log(
        `[notify-admins] RESEND_API_KEY not set — logging instead of sending.\n` +
          `  To: ${admins.map((a) => a.email).join(", ")}\n` +
          `  Subject: ${subject}`,
      );
      return { sent: 0, note: "logged (no API key)" } as const;
    }

    let sent = 0;
    for (const admin of admins) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromEmail,
            to: admin.email,
            subject,
            html: body,
          }),
        });
        if (res.ok) sent++;
        else
          console.warn(
            `[notify-admins] Resend returned ${res.status} for ${admin.email}`,
          );
      } catch (err) {
        console.warn(`[notify-admins] Failed to email ${admin.email}:`, err);
      }
    }

    return { sent } as const;
  });
