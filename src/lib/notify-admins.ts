import { createServerFn } from "@tanstack/react-start";
import nodemailer from "nodemailer";

/**
 * Sends email notifications to all active admins / super admins when a leave
 * request is submitted.  Uses SMTP if the required env vars are set;
 * otherwise falls back to console logging so the app still works in dev.
 *
 * Required env vars for SMTP:
 *   SMTP_HOST     – e.g. "smtp.gmail.com" or "smtp.office365.com"
 *   SMTP_PORT     – e.g. 587 (TLS) or 465 (SSL)
 *   SMTP_USER     – login username / email
 *   SMTP_PASS     – login password or app-specific password
 *   EMAIL_FROM    – sender address, e.g. "SPERO MIS <notifications@verve-energyresources.com>"
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

    // --- SMTP config ---
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = Number(process.env.SMTP_PORT) || 587;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const fromEmail =
      process.env.EMAIL_FROM || "SPERO MIS <notifications@verve-energyresources.com>";

    if (!smtpHost || !smtpUser || !smtpPass) {
      console.log(
        `[notify-admins] SMTP not configured — logging instead of sending.\n` +
          `  To: ${admins.map((a) => a.email).join(", ")}\n` +
          `  Subject: ${subject}`,
      );
      return { sent: 0, note: "logged (no SMTP config)" } as const;
    }

    // Create a reusable transporter
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465, // true for 465 (SSL), false for 587 (STARTTLS)
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    let sent = 0;
    for (const admin of admins) {
      try {
        const info = await transporter.sendMail({
          from: fromEmail,
          to: admin.email,
          subject,
          html: body,
        });
        console.log(`[notify-admins] Email sent to ${admin.email} — ${info.messageId}`);
        sent++;
      } catch (err) {
        console.warn(`[notify-admins] Failed to email ${admin.email}:`, err);
      }
    }

    return { sent } as const;
  });
