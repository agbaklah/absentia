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
3. **Edge function + secrets** — company mail is on Microsoft 365, so send
   through Microsoft Graph (see *Microsoft 365 setup* below), then:
   ```bash
   supabase functions deploy send-notifications --no-verify-jwt
   supabase secrets set MS_TENANT_ID=<tenant guid> MS_CLIENT_ID=<app id> MS_CLIENT_SECRET=<secret value> \
     MS_SENDER=hr@verve-energyresources.com APP_URL=https://<your-vercel-domain> CRON_SECRET=<random>
   ```
   Prove delivery before scheduling anything:
   ```bash
   curl -X POST "https://uftjspyyihaqvqxemfnc.supabase.co/functions/v1/send-notifications?mode=test&to=you@verve-energyresources.com" \
     -H "Authorization: Bearer <CRON_SECRET>"
   ```
   Alternatives: `RESEND_API_KEY` (Resend) or `SMTP_HOST/PORT/USER/PASS`. With no
   transport configured the function runs in dry-run mode (nothing is marked sent).
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

## Microsoft 365 setup (one-time, by a Microsoft 365 / Entra admin)

Absentia sends from a shared mailbox (e.g. `hr@verve-energyresources.com`) using
an app registration with application permission `Mail.Send`. No user password
is stored; SMTP basic auth is not needed (Microsoft has retired it).

1. **Create the sender mailbox** in the Microsoft 365 admin center — a shared
   mailbox `hr@verve-energyresources.com` (free, no licence) or any licensed user.
2. **Register the app** — Entra admin center → *App registrations* → *New
   registration*: name `Absentia notifications`, single tenant, no redirect URI.
   Note the **Application (client) ID** and **Directory (tenant) ID**.
3. **Client secret** — *Certificates & secrets* → *New client secret* (choose
   24 months; set a reminder to rotate). Copy the **Value** immediately.
4. **Permission** — *API permissions* → *Add a permission* → *Microsoft Graph* →
   *Application permissions* → `Mail.Send` → **Grant admin consent**.
5. **Restrict to the one mailbox** (recommended — otherwise the app could send
   as anyone). In Exchange Online PowerShell:
   ```powershell
   Connect-ExchangeOnline
   New-DistributionGroup -Name "Absentia senders" -Type Security -Members hr@verve-energyresources.com
   New-ApplicationAccessPolicy -AppId <client id> -PolicyScopeGroupId "Absentia senders" -AccessRight RestrictAccess -Description "Absentia may only send as hr@"
   Test-ApplicationAccessPolicy -Identity hr@verve-energyresources.com -AppId <client id>   # AccessCheckResult: Granted
   ```
   (Policies take up to 30 minutes to apply.)
6. Set the four `MS_*` secrets (step 3 above) and run the `?mode=test` call.
   Check the mailbox — the test email should arrive from `hr@`.

Rotating the secret later: create a new one in step 3, `supabase secrets set
MS_CLIENT_SECRET=…`, then delete the old one.

## Year-end

Settings → *Year-end rollover*: **Preview** then **Run** in the first week of
January. It is idempotent; re-running skips anyone already rolled over.

## Ports / other local projects

`supabase/config.toml` pins this project to ports 55321+ so it can run next to
other local Supabase projects. If you change them, update `.env.local` too.
