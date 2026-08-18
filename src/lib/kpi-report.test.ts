import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReportHtml, type ReportData } from "@/lib/kpi-report";

function report(overrides: Partial<ReportData> = {}): ReportData {
  return {
    year: 2026,
    teamName: "Operations",
    kpis: {
      absence: 14,
      vacation: 10,
      remaining: 15,
      sick: 2,
      wfh: 1,
      outToday: 3,
      pending: 4,
    },
    monthly: [
      {
        month: "Jan",
        absence: 4,
        vacation: 3,
        sick: 0,
        wfh: 1,
        parental: 0,
        compassionate: 0,
        toil: 0,
      },
      {
        month: "Feb",
        absence: 10,
        vacation: 7,
        sick: 2,
        wfh: 0,
        parental: 0,
        compassionate: 0,
        toil: 1,
      },
    ],
    ...overrides,
  };
}

describe("buildReportHtml", () => {
  it("emits a complete HTML document with doctype and title", () => {
    const html = buildReportHtml(report());
    assert.ok(html.startsWith("<!doctype html>"));
    assert.match(html, /<title>SPERO Internal MIS — KPI Report 2026<\/title>/);
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<\/html>$/);
  });

  it("includes the brand, period, and scope chips", () => {
    const html = buildReportHtml(report());
    assert.match(html, /SPERO Internal MIS/);
    assert.match(html, /Period <b>2026<\/b>/);
    assert.match(html, /Scope <b>Operations<\/b>/);
    assert.match(html, /KPI Report/);
  });

  it("renders one KPI card per metric with the given values", () => {
    const html = buildReportHtml(report());
    // Match only rendered card divs, not the .kpi* CSS selectors in <style>.
    assert.equal((html.match(/class="kpi(?: kpi--accent)?"/g) ?? []).length, 7);
    assert.match(html, /Absence days/);
    assert.match(html, />14\.0</);
    assert.match(html, />10\.0</);
    assert.match(html, /Out today/);
    assert.match(html, />3</);
    assert.match(html, /Pending approvals/);
    assert.match(html, />4</);
  });

  it("marks the vacation-remaining card as accent", () => {
    const html = buildReportHtml(report());
    assert.match(html, /class="kpi kpi--accent"/);
    // Anchor on the rendered card markup (CSS selectors also contain kpi--accent).
    const accentMatch = html.match(/class="kpi kpi--accent"[\s\S]*?kpi__value">([^<]+)</);
    assert.equal(accentMatch?.[1], "15.0");
  });

  it("builds the monthly table rows and a correct total row", () => {
    const html = buildReportHtml(report());
    assert.match(html, /<td class="t-month">Jan<\/td>/);
    assert.match(html, /<td class="t-month">Feb<\/td>/);
    // Total row: absence 4+10=14, vacation 3+7=10, sick 0+2=2, wfh 1+0=1, toil 0+1=1
    const totalRow = html.match(/<tr class="t-total">[\s\S]*?<\/tr>/)?.[0] ?? "";
    assert.match(totalRow, /<td class="t-month">Total<\/td>/);
    assert.match(totalRow, />14\.0</);
    assert.match(totalRow, />10\.0</);
    assert.match(totalRow, />2\.0</);
    assert.match(totalRow, />1\.0</);
    // Zero categories still render as 0.0 (parental & compassionate)
    assert.match(totalRow, />0\.0</);
  });

  it("renders the absence-mix bar with proportional segments", () => {
    const html = buildReportHtml(report());
    // Totals: vacation 10, sick 2, wfh 1, toil 1, parental 0, compassionate 0 → mixTotal 14
    assert.match(html, /<div class="mix">/);
    assert.match(html, /width:71\.43%/); // 10/14 vacation
    assert.match(html, /width:14\.29%/); // 2/14 sick
    // Zero categories contribute no segment (only rendered ones are counted).
    assert.equal((html.match(/class="mix__seg"/g) ?? []).length, 4);
  });

  it("shows the empty-mix message when no category has days", () => {
    const html = buildReportHtml(
      report({
        monthly: [
          {
            month: "Jan",
            absence: 0,
            vacation: 0,
            sick: 0,
            wfh: 0,
            parental: 0,
            compassionate: 0,
            toil: 0,
          },
        ],
      }),
    );
    assert.match(html, /No approved leave recorded/);
    assert.equal(html.includes('<div class="mix">'), false);
  });

  it("escapes HTML in the team name, year, and KPI values", () => {
    const html = buildReportHtml(
      report({
        year: 2026,
        teamName: 'IT & "Specials" <Ops>',
        kpis: { ...report().kpis, outToday: 0 },
      }),
    );
    assert.match(html, /IT &amp; &quot;Specials&quot; &lt;Ops&gt;/);
    // No raw unescaped angle brackets from user data remain in the rendered doc.
    assert.equal(html.includes('"Specials" <Ops>'), false);
    assert.equal(html.includes("<Ops>"), false);
  });

  it("renders the legend with category totals", () => {
    const html = buildReportHtml(report());
    assert.match(html, /class="legend__item"/);
    assert.match(html, />Vacation <b>10\.0<\/b></);
    assert.match(html, /background:#166534/);
    assert.match(html, /background:#dc2626/);
  });

  it("includes the print toolbar and print stylesheet", () => {
    const html = buildReportHtml(report());
    assert.match(html, /onclick="window\.print\(\)"/);
    assert.match(html, /@media print/);
    assert.match(html, /@page \{ size: A4/);
  });

  it("embeds the official FLEET logo as a self-contained data-URI img", () => {
    const html = buildReportHtml(report());
    assert.match(html, /class="brand__mark"/);
    assert.match(html, /<img src="data:image\/png;base64,[^"]+"/);
    assert.match(html, /alt="SPERO"/);
    assert.ok(!html.includes("<svg"), "report should no longer embed a recreated SVG mark");
  });
});
