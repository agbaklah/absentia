# Deployment & operations

## Environments

| | Database | App |
|---|---|---|
| **Local** | `supabase start` (Docker) on ports 55321–55324, `.env.local` | `bun run dev` → http://localhost:8080 |
| **Production** | Supabase project `uftjspyyihaqvqxemfnc` (ABSENTIA) | Vercel project `absentia` |

`.env` is **not tracked** (it holds the service-role key). Keep production keys in
Vercel env vars and in your local `.env`; `.env.local` points at the local stack
and overrides it during development.

## Local development

```bash
supabase start                       # local Postgres, Auth, Storage, Realtime, Studio
supabase migration up                # apply any new migrations
scripts/seed-local.sh                # test accounts for every role (password: Passw0rd!Local)
bun run dev
```

Test accounts: `verveit@` (super admin), `kwame@` (CFO), `ama@` (manager,
Engineers), `esi@` (admin), `kofi@` / `yaw@` (employees) — all
`@verve-energyresources.com`.

Studio: http://127.0.0.1:55323 · Mailpit (local email inbox): http://127.0.0.1:55324

### Testing email locally

The edge function can deliver through SMTP as well as Resend. Locally point it
at Mailpit and every notification email lands in the inbox above:

```bash
supabase functions serve send-notifications --no-verify-jwt --env-file supabase/functions/.env.local
SR=$(supabase status -o env | grep '^SERVICE_ROLE_KEY' | cut -d'"' -f2)
curl -X POST http://127.0.0.1:55321/functions/v1/send-notifications -H "Authorization: Bearer $SR"
curl -X POST "http://127.0.0.1:55321/functions/v1/send-notifications?mode=digest" -H "Authorization: Bearer $SR"
```

`supabase/functions/.env.local` (gitignored) holds `SMTP_HOST=inbucket`,
`SMTP_PORT=1025`, `EMAIL_FROM`, `APP_URL`. In production set `RESEND_API_KEY`
instead (or `SMTP_HOST/PORT/USER/PASS` for a company relay).

## Test gates (run all before pushing to production)

```bash
bun test                             # unit tests (src/lib/*.test.ts)
test/db/run.sh                       # DB tests: RLS, triggers, state machines (local stack)
bunx tsc --noEmit -p tsconfig.json   # types
bun run lint
bun run build
```

`test/db/*.sql` impersonate users by setting JWT claims, so they exercise the
exact RLS + trigger paths the app hits. Each file rolls back.

## Rolling out to production

1. **Migrations** — review `supabase db diff --linked --schema public` (should show
   only the platform's `rls_auto_enable`), then:
   ```bash
   supabase db push
   ```
   Migrations are idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP … IF EXISTS`).
   `20260916000000_baseline_sync_production.sql` is a no-op on production (it
   captures columns that already existed there).
2. **Storage buckets** are created by the migrations (`receipts`, `employee-docs`).
3. **Edge function + secrets**
   ```bash
   supabase functions deploy send-notifications --no-verify-jwt
   supabase secrets set RESEND_API_KEY=re_… EMAIL_FROM="Absentia <hr@verve-energyresources.com>" APP_URL=https://<your-vercel-domain> CRON_SECRET=<random>
   ```
   Without `RESEND_API_KEY` the function runs in dry-run mode (nothing is marked sent).
4. **Schedule it** (SQL editor on production; needs `pg_cron` + `pg_net`, enabled
   under Database → Extensions):
   ```sql
   select cron.schedule('absentia-email', '* * * * *', $$
     select net.http_post(
       url := 'https://uftjspyyihaqvqxemfnc.supabase.co/functions/v1/send-notifications',
       headers := '{"Authorization":"Bearer <CRON_SECRET>","Content-Type":"application/json"}'::jsonb,
       body := '{}'::jsonb);
   $$);
   select cron.schedule('absentia-weekly-digest', '0 7 * * 1', $$
     select net.http_post(
       url := 'https://uftjspyyihaqvqxemfnc.supabase.co/functions/v1/send-notifications?mode=digest',
       headers := '{"Authorization":"Bearer <CRON_SECRET>","Content-Type":"application/json"}'::jsonb,
       body := '{}'::jsonb);
   $$);
   ```
5. **App** — `vercel --prod` (or push to the linked branch). No new env vars are
   required for the app itself.
6. **First-run admin steps** (in the app, as super admin):
   - Employees → set Kwame's role to **CFO** (only a super admin can).
   - Settings → confirm company name, currency (GHS), petty cash limit; import
     Ghana public holidays; review the Standard leave policy (notice days etc.).
   - Employees → each existing employee's record → Personal: add MoMo/bank details
     (or ask staff to do it from *My profile*).

## Year-end

Settings → *Year-end rollover*: **Preview** then **Run** in the first week of
January. It is idempotent; re-running skips anyone already rolled over.

## Ports / other local projects

`supabase/config.toml` pins this project to ports 55321+ so it can run next to
other local Supabase projects. If you change them, update `.env.local` too.
