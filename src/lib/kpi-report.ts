// Designed, print/PDF-ready KPI report. Opens a self-contained styled document
// in a new tab and triggers the print dialog (Save as PDF), so the export is a
// branded template rather than raw CSV.
import { speroLogoImg } from "@/lib/spero-logo";

export type ReportKpis = {
  absence: number;
  vacation: number;
  remaining: number;
  sick: number;
  wfh: number;
  outToday: number;
  pending: number;
};

export type ReportMonth = {
  month: string;
  absence: number;
  vacation: number;
  sick: number;
  wfh: number;
  parental: number;
  compassionate: number;
  toil: number;
};

export type ReportData = {
  year: number;
  teamName: string;
  kpis: ReportKpis;
  monthly: ReportMonth[];
};

const CATEGORIES = [
  { key: "vacation", label: "Vacation", colour: "#166534" },
  { key: "sick", label: "Sick", colour: "#dc2626" },
  { key: "wfh", label: "WFH", colour: "#64748b" },
  { key: "parental", label: "Parental", colour: "#8b5cf6" },
  { key: "compassionate", label: "Compassionate", colour: "#0ea5e9" },
  { key: "toil", label: "TOIL", colour: "#d97706" },
] as const;

const esc = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

const n1 = (v: number) => v.toFixed(1);

export function buildReportHtml(data: ReportData): string {
  const { year, teamName, kpis, monthly } = data;
  const generated = new Date().toLocaleString(undefined, {
    dateStyle: "long",
    timeStyle: "short",
  });

  const totals = CATEGORIES.reduce<Record<string, number>>((acc, c) => {
    acc[c.key] = monthly.reduce((s, m) => s + (m[c.key as keyof ReportMonth] as number), 0);
    return acc;
  }, {});
  const totalAbsence = monthly.reduce((s, m) => s + m.absence, 0);
  const mixTotal = CATEGORIES.reduce((s, c) => s + totals[c.key], 0) || 1;

  const kpiCards = [
    { label: "Absence days", value: n1(kpis.absence) },
    { label: "Vacation taken", value: n1(kpis.vacation) },
    { label: "Vacation remaining", value: n1(kpis.remaining), accent: true },
    { label: "Sick days", value: n1(kpis.sick) },
    { label: "WFH days", value: n1(kpis.wfh) },
    { label: "Out today", value: String(kpis.outToday) },
    { label: "Pending approvals", value: String(kpis.pending) },
  ];

  const kpiHtml = kpiCards
    .map(
      (k) => `
      <div class="kpi${k.accent ? " kpi--accent" : ""}">
        <div class="kpi__label">${esc(k.label)}</div>
        <div class="kpi__value">${esc(k.value)}</div>
      </div>`,
    )
    .join("");

  const mixSegments = CATEGORIES.filter((c) => totals[c.key] > 0)
    .map(
      (c) =>
        `<span class="mix__seg" style="width:${((totals[c.key] / mixTotal) * 100).toFixed(2)}%;background:${c.colour}" title="${esc(c.label)}: ${n1(totals[c.key])}d"></span>`,
    )
    .join("");

  const legendHtml = CATEGORIES.map(
    (c) =>
      `<div class="legend__item"><span class="legend__dot" style="background:${c.colour}"></span>${esc(c.label)} <b>${n1(totals[c.key])}</b></div>`,
  ).join("");

  const rowsHtml = monthly
    .map(
      (m) => `
      <tr>
        <td class="t-month">${esc(m.month)}</td>
        <td>${n1(m.absence)}</td>
        <td>${n1(m.vacation)}</td>
        <td>${n1(m.sick)}</td>
        <td>${n1(m.wfh)}</td>
        <td>${n1(m.parental)}</td>
        <td>${n1(m.compassionate)}</td>
        <td>${n1(m.toil)}</td>
      </tr>`,
    )
    .join("");

  const totalRow = `
      <tr class="t-total">
        <td class="t-month">Total</td>
        <td>${n1(totalAbsence)}</td>
        <td>${n1(totals.vacation)}</td>
        <td>${n1(totals.sick)}</td>
        <td>${n1(totals.wfh)}</td>
        <td>${n1(totals.parental)}</td>
        <td>${n1(totals.compassionate)}</td>
        <td>${n1(totals.toil)}</td>
      </tr>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>SPERO Internal MIS — KPI Report ${esc(year)}</title>
<style>
  :root {
    --ink: #0f172a; --muted: #64748b; --line: #e2e8f0; --bg: #f8fafc;
    --brand: #166534; --brand-soft: #f0fdf4; --accent: #b45309;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--ink); background: var(--bg);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sheet { max-width: 820px; margin: 24px auto; background: #fff; border: 1px solid var(--line);
    border-radius: 14px; overflow: hidden; box-shadow: 0 10px 30px -18px rgba(15,23,42,.35); }

  /* Screen-only toolbar */
  .bar { position: sticky; top: 0; z-index: 10; display: flex; gap: 8px; justify-content: flex-end;
    padding: 12px 16px; background: #fff; border-bottom: 1px solid var(--line); }
  .btn { font: inherit; font-weight: 600; cursor: pointer; border-radius: 8px; padding: 8px 14px; border: 1px solid var(--line); background: #fff; color: var(--ink); }
  .btn--primary { background: var(--brand); border-color: var(--brand); color: #fff; }

  header.rep { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
    padding: 28px 32px 20px; border-bottom: 1px solid var(--line); }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand__mark { width: 42px; height: 42px; border-radius: 9px; background: #fff; border: 1px solid var(--line);
    display: grid; place-items: center; line-height: 0; }
  .brand__mark img { display: block; }
  .brand__name { font-size: 18px; font-weight: 700; letter-spacing: -.01em; }
  .brand__sub { font-size: 12px; color: var(--muted); }
  .rep__title { text-align: right; }
  .rep__title h1 { margin: 0; font-size: 20px; letter-spacing: -.02em; }
  .rep__title .period { color: var(--muted); font-size: 13px; }

  .meta { display: flex; flex-wrap: wrap; gap: 10px; padding: 16px 32px; border-bottom: 1px solid var(--line); }
  .chip { font-size: 12px; color: var(--muted); background: var(--bg); border: 1px solid var(--line);
    border-radius: 999px; padding: 5px 12px; }
  .chip b { color: var(--ink); font-weight: 600; }

  section { padding: 22px 32px; }
  .h { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 0 0 12px; }

  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .kpi { border: 1px solid var(--line); border-radius: 10px; padding: 14px; background: #fff; }
  .kpi--accent { background: var(--brand-soft); border-color: #bbf7d0; }
  .kpi__label { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .kpi__value { font-size: 26px; font-weight: 700; margin-top: 6px; letter-spacing: -.02em; }
  .kpi--accent .kpi__value { color: var(--brand); }

  .mix { height: 16px; border-radius: 999px; overflow: hidden; display: flex; background: var(--line); }
  .mix__seg { display: block; height: 100%; }
  .mix--empty { display: grid; place-items: center; color: var(--muted); font-size: 12px; background: var(--bg); }
  .legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 12px; font-size: 12px; color: var(--muted); }
  .legend__item b { color: var(--ink); }
  .legend__dot { display: inline-block; width: 9px; height: 9px; border-radius: 3px; margin-right: 6px; vertical-align: middle; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead th { text-align: right; font-weight: 600; color: var(--muted); padding: 8px 10px; border-bottom: 1px solid var(--line);
    font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  thead th:first-child, td.t-month { text-align: left; }
  tbody td { text-align: right; padding: 8px 10px; border-bottom: 1px solid var(--bg); }
  tbody tr:nth-child(even) { background: #fcfdfe; }
  .t-total td { border-top: 2px solid var(--line); font-weight: 700; background: #fff; }

  footer.rep { padding: 16px 32px 26px; color: var(--muted); font-size: 11px; display: flex; justify-content: space-between; gap: 12px; }

  @media print {
    body { background: #fff; }
    .sheet { margin: 0; border: 0; border-radius: 0; box-shadow: none; max-width: none; }
    .bar { display: none; }
    @page { size: A4; margin: 14mm; }
    section { padding: 16px 0; }
    header.rep, .meta, footer.rep { padding-left: 0; padding-right: 0; }
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="bar">
      <button class="btn" onclick="window.close()">Close</button>
      <button class="btn btn--primary" onclick="window.print()">Print / Save as PDF</button>
    </div>

    <header class="rep">
      <div class="brand">
        <div class="brand__mark">${speroLogoImg(38)}</div>
        <div>
          <div class="brand__name">SPERO Internal MIS</div>
          <div class="brand__sub">Energy Resources Limited · Leave &amp; Absence</div>
        </div>
      </div>
      <div class="rep__title">
        <h1>KPI Report</h1>
        <div class="period">${esc(year)} · ${esc(teamName)}</div>
      </div>
    </header>

    <div class="meta">
      <span class="chip">Period <b>${esc(year)}</b></span>
      <span class="chip">Scope <b>${esc(teamName)}</b></span>
      <span class="chip">Generated <b>${esc(generated)}</b></span>
    </div>

    <section>
      <p class="h">Summary</p>
      <div class="kpis">${kpiHtml}</div>
    </section>

    <section>
      <p class="h">Absence mix</p>
      ${mixSegments ? `<div class="mix">${mixSegments}</div>` : `<div class="mix mix--empty">No approved leave recorded</div>`}
      <div class="legend">${legendHtml}</div>
    </section>

    <section>
      <p class="h">Monthly breakdown — approved leave (days)</p>
      <table>
        <thead>
          <tr>
            <th>Month</th><th>Absence</th><th>Vacation</th><th>Sick</th>
            <th>WFH</th><th>Parental</th><th>Compass.</th><th>TOIL</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          ${totalRow}
        </tbody>
      </table>
    </section>

    <footer class="rep">
      <span>Generated by SPERO Internal MIS · ${esc(generated)}</span>
      <span>Confidential — internal use only</span>
    </footer>
  </div>
</body>
</html>`;
}

/** Open the designed report in a new tab, ready to print / save as PDF. */
export function openKpiReport(data: ReportData): boolean {
  const html = buildReportHtml(data);
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) return false; // popup blocked
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}
