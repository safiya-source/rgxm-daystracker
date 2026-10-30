# RGXM Daystracker

Internal people platform for RGXM. Phase 1 covers the employee directory, contractual vacation, project-based lieu time, approvals, a shared team calendar, notifications and reports.

- **Stack:** Next.js 15 (App Router, TypeScript, Tailwind CSS v4) + Supabase (Postgres, Auth, Row-Level Security, pg_cron).
- **Business rules:** see [`BUSINESS_RULES.md`](BUSINESS_RULES.md).

## How it's built

```
src/app/(app)/            Signed-in pages (employee + leadership)
src/app/auth, login, …    Sign-in, invitations, password reset
src/lib/rules/            Pure TS rules (tenure, lieu, day counting) for live previews
supabase/migrations/      Schema, RLS policies, and all balance logic (SQL functions)
tests/db/                 Database tests: privacy/RLS, balances, lieu, concurrency, TS↔SQL parity
e2e/                      Playwright end-to-end workflows
scripts/                  bootstrap-admin (first admin) and seed-demo (fictional data, local only)
```

**Security model:**
- **Reads:** every table has Row-Level Security.
  - Employees can read only their own rows.
  - Approvers can read the workflow records of the people they approve.
  - People Admins can read everything.
- **Writes:** users never write to tables directly. Every change goes through a Postgres function that:
  - checks permissions;
  - locks the rows involved;
  - writes to append-only ledgers, so history is never edited;
  - records approvals and audit-log entries.
- **Service-role key:** used only on the server, for invitations, sign-in bans and the scheduled job.

**Balances:** vacation and lieu are ledgers.
- A balance is the sum of its transactions: allocations, accruals, usage, reversals, adjustments, credits and expiry.
- Corrections are new transactions. Nothing is updated or deleted.

**Extending:** `employee_profiles.id` is the central key. Future modules attach to it with their own tables and RLS policies, using the helpers in `private.*`. Examples: `compensation_records(employee_id …)`, `employment_documents`, `performance_reviews`.

## Local development

Requirements: Node 20+, Docker.

```bash
npm install
npm run db:start            # local Supabase; prints URL + keys
cp .env.example .env.local  # paste the anon + service_role keys
npm run db:reset            # apply migrations
npm run seed:demo           # optional: fictional demo team (password: rgxm-demo-2026)
npm run dev                 # http://localhost:3000
```

Local emails (invitations, password resets) are delivered to Mailpit at http://127.0.0.1:54324.

### Tests

```bash
npm run typecheck && npm run lint
npm test            # unit + database tests (needs local Supabase running)
npm run test:e2e    # resets + seeds the local DB, then runs browser tests
```

## Deploying

No command line needed: `supabase/setup/1-database.sql` (all migrations in one file) and `supabase/setup/2-first-admin.sql` can be pasted into the Supabase SQL Editor. Regenerate the first file whenever migrations are added. The CLI route below works too.


1. **Supabase project:**
   - Create it, in the Canada (Central) region (`ca-central-1`).
   - Then run:
     ```bash
     npx supabase link --project-ref <ref>
     npx supabase db push
     ```
   - In Database → Extensions, confirm `pg_cron` is enabled. The migration schedules `private.daily_maintenance()` at 10:15 UTC.
2. **Supabase Auth settings:**
   - Disable public sign-ups.
   - Set the Site URL to your app URL.
   - Add `https://<your-domain>/auth/confirm` to the redirect URLs.
   - Configure SMTP (e.g. Resend) so invitations and password resets are delivered.
3. **Vercel:**
   - Import the repo.
   - Set the environment variables from `.env.example`, with production values.
   - `vercel.json` schedules `/api/cron/daily`, which runs maintenance and sends email notifications when `RESEND_API_KEY` is set and email is enabled in Settings.
4. **First People Admin:**
   ```bash
   npm run bootstrap-admin -- "Full Name" name@rgxm.com 2019-04-01
   ```
   This sends an invitation. Sign in, then follow **Leadership → Overview → Finish setting up**: agency settings → employees (form or CSV import) → approvers → invitations → launch.

Never run `seed:demo` against production. The script refuses non-local URLs unless you pass `--force`.

## Maintenance

- **Daily job:**
  - posts accruals and new-year allocations;
  - applies the carryover cap and lieu expiry, if configured;
  - sends anniversary and upcoming-absence reminders;
  - adds next year's holidays.
- **Running it by hand:** Settings → Agency → *Recalculate balances & send reminders now*.
- **Holidays:** review them each year (Settings → Holidays), e.g. to add office closures.
- **Rule changes:**
  - Changing lieu rules creates a new version with an effective date.
  - Entitlement changes are effective-dated per employee.
  - Neither rewrites history.
- **Corrections:** use *Adjust a balance* on the employee page. A reason is required, and the employee is notified.
- **Leavers:** deactivate (don't delete) to keep records. This also disables their sign-in.
- **Audit trail:** `public.audit_logs` records every change to employees, entitlements, ledgers, requests, settings and holidays (readable by People Admins via SQL).
- **Schema changes:** add a new file in `supabase/migrations/`, run `npm run db:reset && npm test` locally, then `supabase db push`.
