import { Resend } from "resend";

/**
 * Send an email notification to an employee when their leave request
 * is approved or rejected. Uses the Resend API with the project's
 * RESEND_API_KEY and EMAIL_FROM environment variables.
 *
 * This is a server-only module — import it only in server functions
 * or server routes (never in client components).
 */
export async function sendLeaveDecisionEmail({
  to,
  employeeName,
  status,
  leaveType,
  dates,
  decisionNote,
}: {
  to: string;
  employeeName: string;
  status: "approved" | "rejected";
  leaveType: string;
  dates: string;
  decisionNote?: string | null;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.warn("[leave-email] RESEND_API_KEY or EMAIL_FROM not configured — skipping email");
    return;
  }

  const resend = new Resend(apiKey);

  const isApproved = status === "approved";
  const statusLabel = isApproved ? "Approved" : "Rejected";
  const statusColour = isApproved ? "#166534" : "#dc2626";
  const bgColour = isApproved ? "#f0fdf4" : "#fef2f2";
  const borderColour = isApproved ? "#bbf7d0" : "#fecaca";

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
    <div style="background:${statusColour};padding:20px 24px;">
      <h1 style="margin:0;color:#fff;font-size:18px;font-weight:600;">Leave Request ${statusLabel}</h1>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px;color:#334155;font-size:14px;line-height:1.6;">
        Hi <strong>${employeeName}</strong>,
      </p>
      <p style="margin:0 0 16px;color:#334155;font-size:14px;line-height:1.6;">
        Your <strong>${leaveType}</strong> request for <strong>${dates}</strong> has been
        <span style="color:${statusColour};font-weight:600;">${statusLabel.toLowerCase()}</span>.
      </p>
      ${decisionNote ? `
      <div style="margin:0 0 16px;padding:12px 16px;background:${bgColour};border:1px solid ${borderColour};border-radius:8px;">
        <p style="margin:0;color:#475569;font-size:13px;line-height:1.5;">
          <strong>Note from reviewer:</strong> ${decisionNote}
        </p>
      </div>
      ` : ""}
      <p style="margin:0 0 8px;color:#94a3b8;font-size:12px;">
        You can view your updated leave balance in the employee portal.
      </p>
    </div>
    <div style="padding:16px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;">
      <p style="margin:0;color:#94a3b8;font-size:11px;text-align:center;">
        SPERO Internal MIS — Leave &amp; Absence Management
      </p>
    </div>
  </div>
</body>
</html>`;

  try {
    await resend.emails.send({
      from,
      to,
      subject: `Leave Request ${statusLabel} — ${leaveType}`,
      html,
    });
    console.log(`[leave-email] Sent ${status} notification to ${to}`);
  } catch (err) {
    console.error(`[leave-email] Failed to send to ${to}:`, err);
  }
}
