// Email delivery for in-app notifications + a weekly digest.
//
//   POST /send-notifications            → deliver unsent notifications (batch)
//   POST /send-notifications?mode=digest → weekly digest to managers / CFO
//
// Scheduled with pg_cron (see docs/DEPLOYMENT.md). Requires secrets:
//   RESEND_API_KEY, EMAIL_FROM (e.g. "Absentia <hr@verve-energyresources.com>"),
//   APP_URL (e.g. https://absentia.vercel.app)
// Delivery (first configured transport wins):
//   1. Microsoft 365 via Graph — MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET,
//      MS_SENDER (the mailbox to send from, e.g. hr@verve-energyresources.com)
//   2. Resend — RESEND_API_KEY
//   3. SMTP — SMTP_HOST/SMTP_PORT[/SMTP_USER/SMTP_PASS] (local Mailpit, relays)
// With none set the function runs in dry-run mode: it reports what it would
// send and marks nothing, so testing is safe.
//
//   POST /send-notifications?mode=test&to=someone@company.com → one test email

import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";

type Notification = {
  id: string;
  recipient_id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  profiles: { email: string; full_name: string; active: boolean } | null;
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
const SMTP_HOST = Deno.env.get("SMTP_HOST");
const MS = {
  tenant: Deno.env.get("MS_TENANT_ID"),
  client: Deno.env.get("MS_CLIENT_ID"),
  secret: Deno.env.get("MS_CLIENT_SECRET"),
  sender: Deno.env.get("MS_SENDER"),
};
const MS_READY = Boolean(MS.tenant && MS.client && MS.secret && MS.sender);
const LIVE = Boolean(MS_READY || RESEND_KEY || SMTP_HOST);
const TRANSPORT = MS_READY
  ? "microsoft-graph"
  : RESEND_KEY
    ? "resend"
    : SMTP_HOST
      ? "smtp"
      : "dry-run";

// Microsoft Graph: client-credentials token, cached until shortly before expiry.
let msToken: { value: string; exp: number } | null = null;
async function graphToken(): Promise<string> {
  if (msToken && msToken.exp > Date.now() + 60_000) return msToken.value;
  const res = await fetch(`https://login.microsoftonline.com/${MS.tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: MS.client!,
      client_secret: MS.secret!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Microsoft token error ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  msToken = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}
async function sendViaGraph(to: string, subject: string, html: string) {
  const token = await graphToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MS.sender!)}/sendMail`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: html },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: false,
      }),
    },
  );
  if (res.status !== 202) throw new Error(`Graph sendMail ${res.status}: ${await res.text()}`);
}
const smtp = SMTP_HOST
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(Deno.env.get("SMTP_PORT") ?? 587),
      secure: Deno.env.get("SMTP_SECURE") === "true",
      auth: Deno.env.get("SMTP_USER")
        ? { user: Deno.env.get("SMTP_USER"), pass: Deno.env.get("SMTP_PASS") }
        : undefined,
    })
  : null;
const FROM = Deno.env.get("EMAIL_FROM") ?? "Absentia <no-reply@verve-energyresources.com>";
const APP_URL = (Deno.env.get("APP_URL") ?? "https://absentia.vercel.app").replace(/\/$/, "");

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

function layout(title: string, bodyHtml: string, ctaPath?: string, ctaLabel = "Open Absentia") {
  return `<!doctype html><html><body style="margin:0;background:#f4f5f2;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1f2a24">
  <div style="max-width:520px;margin:24px auto;background:#fff;border-radius:12px;border:1px solid #e3e7e2;overflow:hidden">
    <div style="background:#1f4d33;color:#fff;padding:14px 20px;font-weight:600">Absentia · Verve Energy Resources</div>
    <div style="padding:20px">
      <h2 style="margin:0 0 8px;font-size:18px">${esc(title)}</h2>
      ${bodyHtml}
      ${ctaPath ? `<p style="margin:20px 0 0"><a href="${APP_URL}${ctaPath}" style="display:inline-block;background:#1f4d33;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">${esc(ctaLabel)}</a></p>` : ""}
    </div>
    <div style="padding:12px 20px;font-size:12px;color:#6b7a70;border-top:1px solid #e3e7e2">You receive this because you have an Absentia account. Manage notifications in the app.</div>
  </div></body></html>`;
}

async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!LIVE) return { ok: true }; // dry run
  if (MS_READY) {
    try {
      await sendViaGraph(to, subject, html);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  if (!RESEND_KEY && smtp) {
    try {
      await smtp.sendMail({ from: FROM, to, subject, html });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!res.ok) return { ok: false, error: `${res.status} ${await res.text()}` };
  return { ok: true };
}

/** Deliver unsent notifications, grouped per recipient into one email. */
async function deliverPending() {
  const { data, error } = await supabase
    .from("notifications")
    .select(
      "id, recipient_id, kind, title, body, link, created_at, profiles:recipient_id(email, full_name, active)",
    )
    .is("email_sent_at", null)
    .order("created_at")
    .limit(200);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Notification[];

  const byRecipient = new Map<string, Notification[]>();
  for (const n of rows) {
    if (!n.profiles?.email || !n.profiles.active) continue;
    byRecipient.set(n.recipient_id, [...(byRecipient.get(n.recipient_id) ?? []), n]);
  }

  const results: { to: string; count: number; ok: boolean; error?: string }[] = [];
  for (const [, list] of byRecipient) {
    const to = list[0].profiles!.email;
    const subject = list.length === 1 ? list[0].title : `${list.length} updates from Absentia`;
    const items = list
      .map(
        (n) =>
          `<li style="margin:0 0 10px"><b>${esc(n.title)}</b>${n.body ? `<br><span style="color:#4b5a51">${esc(n.body)}</span>` : ""}</li>`,
      )
      .join("");
    const html = layout(
      list.length === 1
        ? list[0].title
        : `Hi ${esc(list[0].profiles!.full_name.split(" ")[0])}, you have ${list.length} updates`,
      `<ul style="padding-left:18px;margin:0">${items}</ul>`,
      list[0].link ?? "/dashboard",
    );
    const r = await sendEmail(to, subject, html);
    results.push({ to, count: list.length, ...r });
    if (r.ok && LIVE) {
      await supabase
        .from("notifications")
        .update({ email_sent_at: new Date().toISOString() })
        .in(
          "id",
          list.map((n) => n.id),
        );
    }
  }
  return { mode: TRANSPORT, pending: rows.length, emails: results };
}

/** Monday digest: managers/admins get who's out + pending; CFO gets claims to review/pay. */
async function weeklyDigest() {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() + ((8 - today.getDay()) % 7 || 7) - 7); // this week's Monday
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const weekStart = iso(monday);
  const weekEnd = iso(new Date(monday.getTime() + 6 * 86_400_000));

  const [profiles, entries, claims, types] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email, role, team_id, active")
      .eq("active", true),
    supabase
      .from("leave_entries")
      .select("employee_id, date, leave_code, status")
      .gte("date", weekStart)
      .lte("date", weekEnd)
      .in("status", ["approved", "pending"]),
    supabase
      .from("expense_claims")
      .select("id, claim_no, title, amount, currency, status, claimant_id")
      .in("status", ["submitted", "approved"]),
    supabase.from("leave_types").select("code, label"),
  ]);
  for (const r of [profiles, entries, claims, types]) if (r.error) throw r.error;
  const people = profiles.data ?? [];
  const name = new Map(people.map((p) => [p.id, p.full_name]));
  const label = new Map((types.data ?? []).map((t) => [t.code, t.label]));
  const results: { to: string; ok: boolean; error?: string }[] = [];

  const recipients = people.filter((p) => ["manager", "admin", "super_admin"].includes(p.role));
  for (const r of recipients) {
    const scope =
      r.role === "manager"
        ? people.filter((p) => p.team_id === r.team_id).map((p) => p.id)
        : people.map((p) => p.id);
    const mine = (entries.data ?? []).filter((e) => scope.includes(e.employee_id));
    const out = new Map<string, string[]>();
    for (const e of mine.filter((e) => e.status === "approved")) {
      const k = `${name.get(e.employee_id)} · ${label.get(e.leave_code) ?? e.leave_code}`;
      out.set(k, [...(out.get(k) ?? []), e.date.slice(8)]);
    }
    const pending = new Set(mine.filter((e) => e.status === "pending").map((e) => e.employee_id))
      .size;
    if (out.size === 0 && pending === 0) continue;
    const html = layout(
      `Week of ${weekStart}`,
      `<p style="margin:0 0 6px;color:#4b5a51">Out this week</p><ul style="padding-left:18px;margin:0 0 14px">${
        [...out]
          .map(
            ([k, days]) => `<li>${esc(k)} — ${days.length} day${days.length > 1 ? "s" : ""}</li>`,
          )
          .join("") || "<li>Nobody</li>"
      }</ul>${pending ? `<p><b>${pending}</b> employee${pending > 1 ? "s have" : " has"} leave waiting for your approval.</p>` : ""}`,
      "/requests",
      "Review requests",
    );
    results.push({
      to: r.email,
      ...(await sendEmail(r.email, `Absentia weekly: ${out.size} out, ${pending} pending`, html)),
    });
  }

  const cfos = people.filter((p) => p.role === "cfo");
  const submitted = (claims.data ?? []).filter((c) => c.status === "submitted");
  const approved = (claims.data ?? []).filter((c) => c.status === "approved");
  if (submitted.length || approved.length) {
    for (const c of cfos) {
      const sum = (l: typeof submitted) => l.reduce((s, x) => s + Number(x.amount), 0).toFixed(2);
      const html = layout(
        "Petty cash this week",
        `<p><b>${submitted.length}</b> claim${submitted.length === 1 ? "" : "s"} awaiting review (${submitted[0]?.currency ?? "GHS"} ${sum(submitted)})<br>
         <b>${approved.length}</b> approved and unpaid (${approved[0]?.currency ?? "GHS"} ${sum(approved)})</p>
         <ul style="padding-left:18px">${[...submitted, ...approved]
           .slice(0, 15)
           .map(
             (x) =>
               `<li>#${x.claim_no} ${esc(x.title)} · ${esc(name.get(x.claimant_id) ?? "")} · ${x.currency} ${Number(x.amount).toFixed(2)} · ${x.status}</li>`,
           )
           .join("")}</ul>`,
        "/expenses/review",
        "Open the queue",
      );
      results.push({
        to: c.email,
        ...(await sendEmail(
          c.email,
          `Petty cash: ${submitted.length} to review, ${approved.length} to pay`,
          html,
        )),
      });
    }
  }
  return { mode: TRANSPORT, week: weekStart, emails: results };
}

Deno.serve(async (req) => {
  // Only the service role (cron / admin) may call this.
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
  const secret = Deno.env.get("CRON_SECRET");
  if (auth !== expected && !(secret && auth === `Bearer ${secret}`)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode");
    if (mode === "test") {
      const to = url.searchParams.get("to") ?? "";
      if (!/^[^@\s]+@[^@\s]+$/.test(to)) throw new Error("Pass ?to=<email>");
      const r = await sendEmail(
        to,
        "Absentia test email",
        layout(
          "Email delivery works",
          `<p>This test was sent through <b>${TRANSPORT}</b> at ${new Date().toISOString()}.</p>`,
          "/dashboard",
        ),
      );
      return new Response(JSON.stringify({ mode: TRANSPORT, to, ...r }), {
        headers: { "content-type": "application/json" },
      });
    }
    const result = mode === "digest" ? await weeklyDigest() : await deliverPending();
    return new Response(JSON.stringify(result), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
