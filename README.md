# Absentia

Leave & Absence Management, People records and Petty Cash for Verve Energy
Resources — a BambooHR-style internal HR system.

Modules: leave requests & approvals · leave policies (accrual, notice, blackout,
carry-over) · calendar & yearly view · petty cash claims with receipt upload and
CFO reimbursement · employee records (personal/payout data, documents, job
history) · onboarding/offboarding checklists · directory & org chart · reports ·
audit log · in-app + email notifications.

See `docs/ROADMAP.md` for scope and `docs/DEPLOYMENT.md` for local testing and
production rollout.

## Development

Requires [Bun](https://bun.sh).

```sh
bun install
bun run dev
```

The dev server runs at http://localhost:8080.

### Scripts

- `bun run dev` — start the dev server
- `bun run build` — production build
- `bun run preview` — preview the production build
- `bun run lint` — run ESLint
- `bun run format` — format with Prettier
- `bun test` — unit tests
- `test/db/run.sh` — database tests against the local Supabase stack

## Environment

Copy the required Supabase variables into `.env`:

```sh
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

## Built with

- TanStack Start
- React
- TypeScript
- Tailwind CSS
- Supabase
