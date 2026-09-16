/** Pure helpers for the People & Records module. */

export const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  intern: "Intern",
};

export const DOC_KIND_LABEL: Record<string, string> = {
  contract: "Contract",
  id: "ID document",
  certificate: "Certificate",
  medical: "Medical",
  policy_ack: "Policy acknowledgement",
  payslip: "Payslip",
  other: "Other",
};

export const CHANGE_KIND_LABEL: Record<string, string> = {
  hired: "Hired",
  change: "Role change",
  promotion: "Promotion",
  transfer: "Transfer",
  left: "Left",
  rehired: "Rehired",
};

export const ID_TYPE_LABEL: Record<string, string> = {
  ghana_card: "Ghana Card",
  passport: "Passport",
  voter_id: "Voter ID",
  drivers_licence: "Driver's licence",
  other: "Other",
};

export const MOMO_LABEL: Record<string, string> = {
  mtn: "MTN MoMo",
  telecel: "Telecel Cash",
  airteltigo: "AirtelTigo Money",
};

/** Show only the last 4 characters of a sensitive number: "•••• 6789". */
export function maskNumber(value: string | null | undefined, keep = 4): string {
  if (!value) return "—";
  const v = value.replace(/\s+/g, "");
  if (v.length <= keep) return "•".repeat(Math.max(0, v.length - 1)) + v.slice(-1);
  return `•••• ${v.slice(-keep)}`;
}

/** Whole years between a date and today (age, tenure). */
export function yearsSince(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  let years = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) years -= 1;
  return years;
}

/** "3y 2m" style tenure from a start date. */
export function tenure(startIso: string, now = new Date()): string {
  const [y, m] = startIso.split("-").map(Number);
  if (!y || !m) return "";
  let months = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
  if (months < 0) months = 0;
  const yrs = Math.floor(months / 12);
  const mos = months % 12;
  if (yrs === 0) return `${mos} mo`;
  return mos === 0 ? `${yrs} yr${yrs > 1 ? "s" : ""}` : `${yrs}y ${mos}m`;
}

/** Progress of a checklist: done / total. */
export function checklistProgress<T extends { done_at: string | null }>(tasks: T[]) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.done_at).length;
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** Days until a due date (negative = overdue), based on ISO date strings. */
export function daysUntil(iso: string | null, todayIso: string): number | null {
  if (!iso) return null;
  const a = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const b = Date.UTC(+todayIso.slice(0, 4), +todayIso.slice(5, 7) - 1, +todayIso.slice(8, 10));
  return Math.round((a - b) / 86_400_000);
}

export type OrgNode = {
  id: string;
  name: string;
  title: string | null;
  teamName: string | null;
  children: OrgNode[];
};

/**
 * Build an org tree: team managers (teams.manager_id) at the top, their team
 * members below. Members whose team has no manager sit under a virtual team
 * node; people without a team go under "Unassigned".
 */
export function buildOrgTree(
  people: {
    id: string;
    full_name: string;
    job_title: string | null;
    team_id: string | null;
    role: string;
  }[],
  teams: { id: string; name: string; manager_id: string | null }[],
): OrgNode[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const teamName = (tid: string | null) => teams.find((t) => t.id === tid)?.name ?? null;
  const roots: OrgNode[] = [];
  const placed = new Set<string>();

  for (const t of teams) {
    const members = people.filter((p) => p.team_id === t.id && p.id !== t.manager_id);
    const manager = t.manager_id ? byId.get(t.manager_id) : undefined;
    const children = members.map((m) => {
      placed.add(m.id);
      return { id: m.id, name: m.full_name, title: m.job_title, teamName: t.name, children: [] };
    });
    if (manager) {
      placed.add(manager.id);
      roots.push({
        id: manager.id,
        name: manager.full_name,
        title: manager.job_title ?? "Manager",
        teamName: t.name,
        children,
      });
    } else if (children.length) {
      roots.push({
        id: `team:${t.id}`,
        name: t.name,
        title: "No manager assigned",
        teamName: t.name,
        children,
      });
    }
  }
  const rest = people.filter((p) => !placed.has(p.id));
  if (rest.length) {
    roots.push({
      id: "team:unassigned",
      name: "Unassigned",
      title: null,
      teamName: null,
      children: rest.map((m) => ({
        id: m.id,
        name: m.full_name,
        title: m.job_title,
        teamName: teamName(m.team_id),
        children: [],
      })),
    });
  }
  return roots;
}
