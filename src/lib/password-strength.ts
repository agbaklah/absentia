export type PasswordCheck = { label: string; met: boolean };

export type PasswordStrength = {
  /** 0 (very weak) … 4 (strong) */
  score: number;
  label: string;
  checks: PasswordCheck[];
};

const CHECK_DEFS: { label: string; test: (p: string) => boolean }[] = [
  { label: "At least 8 characters", test: (p) => p.length >= 8 },
  { label: "Uppercase letter (A–Z)", test: (p) => /[A-Z]/.test(p) },
  { label: "Lowercase letter (a–z)", test: (p) => /[a-z]/.test(p) },
  { label: "Number (0–9)", test: (p) => /\d/.test(p) },
  { label: "Symbol (!@#$…)", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

const LABELS = ["Very weak", "Weak", "Fair", "Good", "Strong"];

/** Score 0–4 from how many of the five criteria are met. */
export function passwordStrength(password: string): PasswordStrength {
  const checks = CHECK_DEFS.map((c) => ({ label: c.label, met: c.test(password) }));
  const met = checks.filter((c) => c.met).length;
  const score = met <= 1 ? 0 : met === 2 ? 1 : met === 3 ? 2 : met === 4 ? 3 : 4;
  return { score, label: LABELS[score], checks };
}
