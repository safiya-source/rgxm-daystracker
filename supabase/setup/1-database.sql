-- RGXM People: complete database setup for a NEW Supabase project.
-- Generated from supabase/migrations/* (in order). Paste into Supabase → SQL Editor and click Run, once.
-- Later schema changes ship as new migration files; don't re-run this.


-- ===================== 20261023000001_core_schema.sql =====================
-- RGXM People — core schema
-- employee_profiles is the central entity. Future modules (compensation,
-- documents, reviews, onboarding…) should reference employee_profiles(id).

create schema if not exists private;  -- helper functions not exposed via the API
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('employee', 'manager', 'people_admin');
create type public.employment_status as enum ('active', 'inactive');
create type public.vacation_year_type as enum ('calendar', 'anniversary');
create type public.allocation_method as enum ('upfront', 'accrual');
create type public.time_off_kind as enum ('vacation', 'lieu');
create type public.lieu_category as enum ('discretionary', 'statutory');
create type public.day_portion as enum ('full', 'am', 'pm');
create type public.request_status as enum ('pending', 'approved', 'declined', 'cancelled');
create type public.lieu_submission_status as enum ('pending', 'approved', 'declined', 'changes_requested', 'cancelled');
create type public.lieu_day_type as enum ('weekend', 'weekday', 'holiday');
create type public.holiday_kind as enum ('statutory', 'closure');

create type public.vacation_txn_type as enum (
  'opening_balance',    -- balance carried in when tracking started
  'opening_carryover',  -- prior-year carryover entered at onboarding
  'allocation',         -- upfront annual allocation (incl. proration / entitlement-change true-ups)
  'accrual',            -- progressive monthly accrual
  'usage',              -- approved vacation (negative)
  'usage_reversal',     -- cancellation of approved vacation (positive)
  'adjustment',         -- documented manual adjustment
  'carryover_forfeit'   -- amount above the carryover cap at year end (negative)
);

create type public.lieu_txn_type as enum (
  'opening_balance', 'credit', 'usage', 'usage_reversal', 'adjustment', 'expiry'
);

-- ---------------------------------------------------------------------------
-- Agency settings (singleton) & rule versions
-- ---------------------------------------------------------------------------
create table public.agency_settings (
  id smallint primary key default 1 check (id = 1),
  agency_name text not null default 'RGXM',
  timezone text not null default 'America/Toronto',
  working_days smallint[] not null default '{1,2,3,4,5}',  -- ISO weekday 1=Mon … 7=Sun
  standard_day_hours numeric(4,2) not null default 8 check (standard_day_hours > 0 and standard_day_hours <= 24),
  default_vacation_year public.vacation_year_type not null default 'calendar',
  default_allocation public.allocation_method not null default 'upfront',
  carryover_cap_days numeric(6,2) check (carryover_cap_days is null or carryover_cap_days >= 0), -- null = unlimited
  allow_negative_vacation boolean not null default false,
  allow_half_days boolean not null default true,
  lieu_expiry_months smallint check (lieu_expiry_months is null or lieu_expiry_months > 0),     -- null = never
  coverage_warning_threshold smallint not null default 2 check (coverage_warning_threshold >= 1),
  anniversary_reminder_days smallint[] not null default '{30,7,0}',
  absence_reminder_days smallint not null default 3,
  email_notifications_enabled boolean not null default false,
  onboarding_completed boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.agency_settings (id) values (1);

-- Lieu rules are versioned: each work entry records the version used, so a
-- settings change never rewrites historical credits.
create table public.lieu_rule_versions (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null unique,
  weekend_half_min_hours numeric(4,2) not null default 2,
  weekend_half_credit numeric(3,2) not null default 0.5,
  weekend_full_min_hours numeric(4,2) not null default 4,
  weekend_full_credit numeric(3,2) not null default 1,
  weekday_min_hours numeric(4,2) not null default 10,
  weekday_credit numeric(3,2) not null default 0.5,
  weekday_review_above_hours numeric(4,2) not null default 12,
  require_approval boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  check (weekend_half_min_hours <= weekend_full_min_hours),
  check (weekday_min_hours <= weekday_review_above_hours)
);
insert into public.lieu_rule_versions (effective_from) values ('2000-01-01');

create table public.public_holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name text not null,
  kind public.holiday_kind not null default 'statutory',
  created_at timestamptz not null default now(),
  created_by uuid
);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.employee_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users (id) on delete set null,
  full_name text not null check (length(trim(full_name)) > 0),
  work_email text not null check (work_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  job_title text,
  department text,
  start_date date not null,
  status public.employment_status not null default 'active',
  role public.app_role not null default 'employee',
  manager_id uuid references public.employee_profiles (id),          -- primary approver
  backup_approver_id uuid references public.employee_profiles (id),
  standard_day_hours numeric(4,2) check (standard_day_hours is null or (standard_day_hours > 0 and standard_day_hours <= 24)),
  invited_at timestamptz,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (manager_id is distinct from id),
  check (backup_approver_id is distinct from id)
);
create unique index employee_profiles_email_key on public.employee_profiles (lower(work_email));
create index on public.employee_profiles (manager_id);
create index on public.employee_profiles (backup_approver_id);

-- Effective-dated history of employment details (written automatically on change).
create table public.employment_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles (id) on delete cascade,
  effective_from date not null,
  job_title text,
  department text,
  status public.employment_status not null,
  role public.app_role not null,
  manager_id uuid references public.employee_profiles (id),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid
);
create index on public.employment_records (employee_id, effective_from);

-- Contractual entitlements, effective-dated. The row with the latest
-- effective_from <= a given date applies on that date.
create table public.vacation_entitlements (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles (id) on delete cascade,
  effective_from date not null,
  annual_days numeric(5,2) not null check (annual_days >= 0 and annual_days <= 366),
  year_type public.vacation_year_type not null,
  allocation_method public.allocation_method not null,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (employee_id, effective_from)
);

-- Per-employee tracking metadata. tracking_start is the date from which the
-- ledger is authoritative (opening balances are as of this date).
create table public.vacation_tracking (
  employee_id uuid primary key references public.employee_profiles (id) on delete cascade,
  tracking_start date not null,
  is_new_hire boolean not null default false  -- new hires get a prorated first-period allocation
);

-- ---------------------------------------------------------------------------
-- Ledgers (append-only)
-- ---------------------------------------------------------------------------
create table public.vacation_transactions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles (id),
  txn_type public.vacation_txn_type not null,
  amount numeric(7,2) not null,
  effective_date date not null,
  period_start date,            -- vacation year this transaction belongs to (allocations/accruals/forfeits)
  accrual_key text,             -- idempotency grouping for system-generated rows, e.g. 'alloc:2026-01-01'
  request_id uuid,
  reason text,
  created_by uuid,              -- employee_profiles.id of the actor (null = system)
  created_at timestamptz not null default now()
);
create index on public.vacation_transactions (employee_id, effective_date);
create index on public.vacation_transactions (employee_id, accrual_key);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  client text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.employee_profiles (id)
);
create unique index projects_name_key on public.projects (lower(trim(name)));

create table public.lieu_submissions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles (id),
  project_id uuid not null references public.projects (id),
  status public.lieu_submission_status not null default 'pending',
  source text not null default 'employee' check (source in ('employee', 'bulk')),
  note text,
  total_proposed numeric(6,2) not null default 0,
  total_approved numeric(6,2),
  adjustment_reason text,
  needs_review boolean not null default false,
  submitted_by uuid references public.employee_profiles (id),
  approver_id uuid references public.employee_profiles (id),
  reviewed_by uuid references public.employee_profiles (id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.lieu_submissions (employee_id, status);
create index on public.lieu_submissions (status);

create table public.lieu_work_entries (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.lieu_submissions (id) on delete cascade,
  employee_id uuid not null references public.employee_profiles (id),
  project_id uuid not null references public.projects (id),
  work_date date not null,
  hours numeric(4,2) not null check (hours > 0 and hours <= 24),
  day_type public.lieu_day_type not null,
  rule_version_id uuid not null references public.lieu_rule_versions (id),
  proposed_credit numeric(3,2) not null,
  approved_credit numeric(3,2),
  category public.lieu_category not null default 'discretionary',
  needs_review boolean not null default false,
  review_reason text,
  is_active boolean not null default true  -- false once the submission is declined/cancelled
);
-- One credit claim per employee per work date.
create unique index lieu_work_entries_one_per_day on public.lieu_work_entries (employee_id, work_date) where is_active;
create index on public.lieu_work_entries (project_id);

create table public.lieu_transactions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles (id),
  category public.lieu_category not null default 'discretionary',
  txn_type public.lieu_txn_type not null,
  amount numeric(7,2) not null,
  effective_date date not null,
  submission_id uuid references public.lieu_submissions (id),
  request_id uuid,
  project_id uuid references public.projects (id),
  reason text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index on public.lieu_transactions (employee_id, category, effective_date);

-- ---------------------------------------------------------------------------
-- Time-off requests (vacation & lieu usage)
-- ---------------------------------------------------------------------------
create table public.time_off_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles (id),
  kind public.time_off_kind not null,
  lieu_category public.lieu_category,
  is_advance boolean not null default false,       -- lieu day given ahead of an upcoming project
  project_id uuid references public.projects (id), -- required for advance lieu
  start_date date not null,
  end_date date not null,
  portion public.day_portion not null default 'full',
  days numeric(5,2) not null check (days > 0),
  note text,
  status public.request_status not null default 'pending',
  approver_id uuid references public.employee_profiles (id),
  reviewed_by uuid references public.employee_profiles (id),
  reviewed_at timestamptz,
  review_note text,
  cancelled_by uuid references public.employee_profiles (id),
  cancelled_at timestamptz,
  created_by uuid references public.employee_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (portion = 'full' or start_date = end_date),
  check ((kind = 'lieu') = (lieu_category is not null)),
  check (not is_advance or (kind = 'lieu' and project_id is not null))
);
create index on public.time_off_requests (employee_id, status);
create index on public.time_off_requests (status, start_date);

create table public.time_off_request_days (
  request_id uuid not null references public.time_off_requests (id) on delete cascade,
  employee_id uuid not null references public.employee_profiles (id),
  leave_date date not null,
  portion public.day_portion not null,
  amount numeric(3,2) not null check (amount in (0.5, 1)),
  is_active boolean not null default true,  -- pending or approved
  primary key (request_id, leave_date)
);
create index on public.time_off_request_days (employee_id, leave_date) where is_active;
create index on public.time_off_request_days (leave_date) where is_active;

alter table public.vacation_transactions add constraint vacation_transactions_request_fk
  foreign key (request_id) references public.time_off_requests (id);
alter table public.lieu_transactions add constraint lieu_transactions_request_fk
  foreign key (request_id) references public.time_off_requests (id);

-- ---------------------------------------------------------------------------
-- Approvals, notifications, audit
-- ---------------------------------------------------------------------------
create table public.approval_records (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('time_off_request', 'lieu_submission')),
  subject_id uuid not null,
  action text not null check (action in ('submitted', 'resubmitted', 'approved', 'declined', 'changes_requested', 'cancelled', 'adjusted')),
  actor_id uuid references public.employee_profiles (id),
  note text,
  created_at timestamptz not null default now()
);
create index on public.approval_records (subject_type, subject_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.employee_profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  dedupe_key text unique,
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (recipient_id, created_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  table_name text not null,
  record_id text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_logs (table_name, record_id);
create index on public.audit_logs (created_at desc);

-- ===================== 20261023000002_helpers_and_security.sql =====================
-- Helpers, date utilities, Row-Level Security, audit logging.

-- ---------------------------------------------------------------------------
-- "Today" in agency time. Tests may pin it with: set app.today = 'YYYY-MM-DD'.
-- ---------------------------------------------------------------------------
create or replace function private.today() returns date
language sql stable as $$
  select coalesce(
    nullif(current_setting('app.today', true), '')::date,
    (now() at time zone coalesce((select timezone from public.agency_settings where id = 1), 'America/Toronto'))::date
  );
$$;

-- ---------------------------------------------------------------------------
-- Identity & authorization helpers (security definer → no RLS recursion)
-- ---------------------------------------------------------------------------
create or replace function private.current_employee_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.employee_profiles
  where user_id = auth.uid() and status = 'active';
$$;

create or replace function private.is_people_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.employee_profiles
    where user_id = auth.uid() and status = 'active' and role = 'people_admin'
  );
$$;

-- Can the current user approve requests for employee `target`?
--  * never their own
--  * the employee's assigned manager or backup approver can
--  * People Admins can approve anyone except other People Admins, whose
--    requests go to their assigned approver (e.g. the owner). If an admin has
--    no approver assigned, any other People Admin may approve.
create or replace function private.can_approve(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with me as (
    select id, role from public.employee_profiles
    where user_id = auth.uid() and status = 'active'
  ), t as (
    select id, role, manager_id, backup_approver_id from public.employee_profiles where id = target
  )
  select coalesce((
    select t.id <> me.id and (
      me.id in (t.manager_id, t.backup_approver_id)
      or (me.role = 'people_admin' and (
            t.role <> 'people_admin'
            or (t.manager_id is null and t.backup_approver_id is null)))
    )
    from me, t
  ), false);
$$;

create or replace function private.can_view_private(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select target = private.current_employee_id() or private.is_people_admin();
$$;

grant execute on all functions in schema private to authenticated, service_role;

-- Public wrappers so the app can ask "who am I" cheaply.
create or replace function public.my_profile_id() returns uuid
language sql stable security definer set search_path = '' as $$ select private.current_employee_id(); $$;

-- ---------------------------------------------------------------------------
-- Date utilities
-- ---------------------------------------------------------------------------
-- Anniversary of `start_date` in year `yr`; Feb 29 starts use Feb 28 in common years.
create or replace function public.anniversary_in_year(start_date date, yr int) returns date
language sql immutable as $$
  select case
    when extract(month from start_date) = 2 and extract(day from start_date) = 29
         and not (yr % 4 = 0 and (yr % 100 <> 0 or yr % 400 = 0))
      then make_date(yr, 2, 28)
    else make_date(yr, extract(month from start_date)::int, extract(day from start_date)::int)
  end;
$$;

-- Next anniversary on or after as_of (the first anniversary is one year after start).
create or replace function public.next_anniversary(start_date date, as_of date) returns date
language sql immutable as $$
  with y as (select greatest(extract(year from as_of)::int, extract(year from start_date)::int + 1) as yr)
  select case
    when public.anniversary_in_year(start_date, yr) >= as_of then public.anniversary_in_year(start_date, yr)
    else public.anniversary_in_year(start_date, yr + 1)
  end from y;
$$;

create or replace function public.years_of_service(start_date date, as_of date) returns int
language sql immutable as $$
  select case when as_of < start_date then 0 else
    (extract(year from as_of)::int - extract(year from start_date)::int)
    - case when public.anniversary_in_year(start_date, extract(year from as_of)::int) > as_of then 1 else 0 end
  end;
$$;

create or replace function public.is_working_day(d date) returns boolean
language sql stable security definer set search_path = '' as $$
  select extract(isodow from d)::smallint = any (s.working_days)
     and not exists (select 1 from public.public_holidays h where h.holiday_date = d)
  from public.agency_settings s where s.id = 1;
$$;

create or replace function public.is_holiday(d date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.public_holidays where holiday_date = d);
$$;

-- Ontario's nine ESA public holidays for a year.
create or replace function public.ontario_stat_holidays(yr int)
returns table (holiday_date date, name text)
language plpgsql immutable as $$
declare
  a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; mon int; dy int;
  easter date; may24 date;
begin
  -- Anonymous Gregorian algorithm for Easter Sunday
  a := yr % 19; b := yr / 100; c := yr % 100; d := b / 4; e := b % 4;
  f := (b + 8) / 25; g := (b - f + 1) / 3; h := (19 * a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  mon := (h + l - 7 * m + 114) / 31; dy := ((h + l - 7 * m + 114) % 31) + 1;
  easter := make_date(yr, mon, dy);
  may24 := make_date(yr, 5, 24);

  return query values
    (make_date(yr, 1, 1), 'New Year''s Day'),
    (make_date(yr, 2, 1) + ((8 - extract(isodow from make_date(yr, 2, 1))::int) % 7) + 14, 'Family Day'),
    (easter - 2, 'Good Friday'),
    (may24 - ((extract(isodow from may24)::int - 1) % 7), 'Victoria Day'),  -- Monday on or before May 24
    (make_date(yr, 7, 1), 'Canada Day'),
    (make_date(yr, 9, 1) + ((8 - extract(isodow from make_date(yr, 9, 1))::int) % 7), 'Labour Day'),
    (make_date(yr, 10, 1) + ((8 - extract(isodow from make_date(yr, 10, 1))::int) % 7) + 7, 'Thanksgiving Day'),
    (make_date(yr, 12, 25), 'Christmas Day'),
    (make_date(yr, 12, 26), 'Boxing Day');
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers: updated_at, employment history, append-only ledgers, audit
-- ---------------------------------------------------------------------------
create or replace function private.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;

create trigger employee_profiles_touch before update on public.employee_profiles
  for each row execute function private.touch_updated_at();
create trigger time_off_requests_touch before update on public.time_off_requests
  for each row execute function private.touch_updated_at();
create trigger lieu_submissions_touch before update on public.lieu_submissions
  for each row execute function private.touch_updated_at();

create or replace function private.record_employment_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or (old.job_title, old.department, old.status, old.role, old.manager_id)
       is distinct from (new.job_title, new.department, new.status, new.role, new.manager_id) then
    insert into public.employment_records (employee_id, effective_from, job_title, department, status, role, manager_id, created_by)
    values (new.id, case when tg_op = 'INSERT' then new.start_date else private.today() end,
            new.job_title, new.department, new.status, new.role, new.manager_id, private.current_employee_id());
  end if;
  return new;
end;
$$;
create trigger employee_profiles_history after insert or update on public.employee_profiles
  for each row execute function private.record_employment_history();

create or replace function private.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only; record a correcting transaction instead', tg_table_name
    using errcode = 'P0001';
end;
$$;
create trigger vacation_transactions_append_only before update or delete on public.vacation_transactions
  for each row execute function private.forbid_mutation();
create trigger lieu_transactions_append_only before update or delete on public.lieu_transactions
  for each row execute function private.forbid_mutation();
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function private.forbid_mutation();
create trigger approval_records_append_only before update or delete on public.approval_records
  for each row execute function private.forbid_mutation();

create or replace function private.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare rec jsonb;
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.audit_logs (actor_user_id, table_name, record_id, action, old_data, new_data)
  values (auth.uid(), tg_table_name, rec ->> (case when rec ? 'id' then 'id' else 'employee_id' end), lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['employee_profiles', 'vacation_entitlements', 'vacation_tracking', 'vacation_transactions',
                           'lieu_transactions', 'time_off_requests', 'lieu_submissions', 'lieu_work_entries',
                           'agency_settings', 'lieu_rule_versions', 'public_holidays', 'projects']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function private.audit()', t || '_audit', t);
  end loop;
end $$;

-- Link a newly created auth user (invite) to the employee profile with the same email.
create or replace function private.link_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.employee_profiles
     set user_id = new.id
   where lower(work_email) = lower(new.email) and user_id is null;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.link_auth_user();

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- All writes go through security-definer RPCs, so authenticated users get
-- SELECT policies only. anon gets nothing.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['agency_settings', 'lieu_rule_versions', 'public_holidays', 'employee_profiles',
                           'employment_records', 'vacation_entitlements', 'vacation_tracking', 'vacation_transactions',
                           'projects', 'lieu_submissions', 'lieu_work_entries', 'lieu_transactions',
                           'time_off_requests', 'time_off_request_days', 'approval_records', 'notifications', 'audit_logs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Non-sensitive reference data
create policy "authenticated read" on public.agency_settings for select to authenticated using (true);
create policy "authenticated read" on public.lieu_rule_versions for select to authenticated using (true);
create policy "authenticated read" on public.public_holidays for select to authenticated using (true);
create policy "authenticated read" on public.projects for select to authenticated using (private.current_employee_id() is not null);

-- Profiles: self, People Admins, and approvers for the people they approve.
create policy "self, admin or approver" on public.employee_profiles for select to authenticated
  using (id = private.current_employee_id() or private.is_people_admin() or private.can_approve(id));

-- Strictly private: self or People Admin only.
create policy "self or admin" on public.employment_records for select to authenticated using (private.can_view_private(employee_id));
create policy "self or admin" on public.vacation_entitlements for select to authenticated using (private.can_view_private(employee_id));
create policy "self or admin" on public.vacation_tracking for select to authenticated using (private.can_view_private(employee_id));
create policy "self or admin" on public.vacation_transactions for select to authenticated using (private.can_view_private(employee_id));
create policy "self or admin" on public.lieu_transactions for select to authenticated using (private.can_view_private(employee_id));

-- Workflow records: self, admin, or the employee's approver.
create policy "self, admin or approver" on public.time_off_requests for select to authenticated
  using (private.can_view_private(employee_id) or private.can_approve(employee_id));
create policy "self, admin or approver" on public.time_off_request_days for select to authenticated
  using (private.can_view_private(employee_id) or private.can_approve(employee_id));
create policy "self, admin or approver" on public.lieu_submissions for select to authenticated
  using (private.can_view_private(employee_id) or private.can_approve(employee_id));
create policy "self, admin or approver" on public.lieu_work_entries for select to authenticated
  using (private.can_view_private(employee_id) or private.can_approve(employee_id));

alter table public.approval_records add column subject_employee_id uuid references public.employee_profiles (id);
create policy "self, admin or approver" on public.approval_records for select to authenticated
  using (private.can_view_private(subject_employee_id) or private.can_approve(subject_employee_id));

create policy "own notifications" on public.notifications for select to authenticated
  using (recipient_id = private.current_employee_id());

create policy "admin only" on public.audit_logs for select to authenticated using (private.is_people_admin());

-- Functions are not callable by anon unless explicitly granted.
alter default privileges in schema public revoke execute on functions from public, anon;
revoke execute on all functions in schema public from public, anon;

-- ===================== 20261023000003_vacation_engine.sql =====================
-- Vacation engine: periods, allocation/accrual sync, balances, employee admin.

-- ---------------------------------------------------------------------------
-- Notification helpers (used by every workflow)
-- ---------------------------------------------------------------------------
create or replace function private.notify(recipient uuid, ntype text, ntitle text, nbody text default null,
                                          nlink text default null, dedupe text default null) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (recipient_id, type, title, body, link, dedupe_key)
  select recipient, ntype, ntitle, nbody, nlink, dedupe
  where recipient is not null
  on conflict (dedupe_key) do nothing;
$$;

-- Everyone who should hear about a request from `emp`: assigned approver and backup;
-- if neither is set, all active People Admins (excluding the employee).
create or replace function private.approver_ids(emp uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  with t as (select manager_id, backup_approver_id from public.employee_profiles where id = emp),
  assigned as (
    select p.id from public.employee_profiles p, t
    where p.id in (t.manager_id, t.backup_approver_id) and p.status = 'active' and p.id <> emp
  )
  select id from assigned
  union
  select p.id from public.employee_profiles p
  where not exists (select 1 from assigned) and p.role = 'people_admin' and p.status = 'active' and p.id <> emp;
$$;

create or replace function private.require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := private.current_employee_id();
begin
  if me is null or not private.is_people_admin() then
    raise exception 'Only People Admins can do this' using errcode = '42501';
  end if;
  return me;
end;
$$;

create or replace function private.require_employee() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := private.current_employee_id();
begin
  if me is null then
    raise exception 'Your account is not active' using errcode = '42501';
  end if;
  return me;
end;
$$;

-- ---------------------------------------------------------------------------
-- Entitlements & periods
-- ---------------------------------------------------------------------------
create or replace function private.entitlement_at(emp uuid, d date) returns public.vacation_entitlements
language sql stable security definer set search_path = '' as $$
  select * from public.vacation_entitlements
  where employee_id = emp and effective_from <= d
  order by effective_from desc limit 1;
$$;

-- Vacation year containing date d for employee emp.
create or replace function public.vacation_period(emp uuid, d date, out period_start date, out period_end date)
language plpgsql stable security definer set search_path = '' as $$
declare
  ent public.vacation_entitlements;
  yt public.vacation_year_type;
  sd date;
  a date;
begin
  ent := private.entitlement_at(emp, d);
  if ent.id is null then
    select e.year_type into ent.year_type from public.vacation_entitlements e
    where e.employee_id = emp order by e.effective_from limit 1;
  end if;
  yt := coalesce(ent.year_type, (select default_vacation_year from public.agency_settings where id = 1));
  if yt = 'calendar' then
    period_start := make_date(extract(year from d)::int, 1, 1);
    period_end := make_date(extract(year from d)::int, 12, 31);
  else
    select start_date into sd from public.employee_profiles where id = emp;
    a := public.anniversary_in_year(sd, extract(year from d)::int);
    if a > d then a := public.anniversary_in_year(sd, extract(year from d)::int - 1); end if;
    period_start := a;
    period_end := public.anniversary_in_year(sd, extract(year from a)::int + 1) - 1;
  end if;
end;
$$;

-- Σ annual_days × (days covered) / per_days over entitlement segments within [from_d, to_d].
create or replace function private.entitlement_integral(emp uuid, from_d date, to_d date, per_days numeric)
returns numeric language sql stable security definer set search_path = '' as $$
  with e as (
    select effective_from, annual_days,
           lead(effective_from) over (order by effective_from) as next_from
    from public.vacation_entitlements where employee_id = emp
  )
  select coalesce(sum(annual_days * greatest(0,
           least(coalesce(next_from, to_d + 1), to_d + 1) - greatest(effective_from, from_d))) / per_days, 0)
  from e
  where from_d <= to_d;
$$;

create or replace function private.ceil_half(x numeric) returns numeric
language sql immutable as $$ select ceil(x * 2) / 2.0; $$;

-- ---------------------------------------------------------------------------
-- Sync: materialise allocations, accruals and year-end carryover forfeits into
-- the ledger. Idempotent — safe to run any number of times.
-- ---------------------------------------------------------------------------
create or replace function private.sync_vacation(emp uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  today date := private.today();
  prof public.employee_profiles;
  trk public.vacation_tracking;
  coverage_start date;
  cur date;
  ps date; pe date;
  ent public.vacation_entitlements;
  base public.vacation_entitlements;
  target numeric; existing numeric; key text;
  m_start date; m_end date; cum numeric; prev_cum numeric; m_period date;
  cap numeric; bal numeric;
  pdays int;
begin
  select * into prof from public.employee_profiles where id = emp;
  select * into trk from public.vacation_tracking where employee_id = emp;
  if prof.id is null or trk.employee_id is null then return; end if;

  -- Serialise syncs for one employee.
  perform 1 from public.vacation_tracking where employee_id = emp for update;

  coverage_start := case when trk.is_new_hire then prof.start_date else trk.tracking_start end;
  base := private.entitlement_at(emp, trk.tracking_start);

  -- Upfront allocations: one target per vacation year from coverage start through the current year.
  cur := coverage_start;
  while cur <= today loop
    select v.period_start, v.period_end into ps, pe from public.vacation_period(emp, cur) v;
    ent := private.entitlement_at(emp, greatest(ps, coverage_start));
    if ent.id is null then
      select * into ent from public.vacation_entitlements where employee_id = emp and effective_from <= pe
      order by effective_from limit 1;
    end if;
    if ent.id is not null and ent.allocation_method = 'upfront' then
      pdays := pe - ps + 1;
      target := private.entitlement_integral(emp, greatest(ps, coverage_start), pe, pdays);
      if not trk.is_new_hire and ps <= trk.tracking_start and trk.tracking_start <= pe then
        -- The opening balance already covers this year at the original entitlement;
        -- only true-up later entitlement changes.
        target := target - coalesce(base.annual_days, 0) * (pe - trk.tracking_start + 1) / pdays::numeric;
      end if;
      target := case when target >= 0 then private.ceil_half(target) else -private.ceil_half(-target) end;
      key := 'alloc:' || ps;
      select coalesce(sum(amount), 0) into existing from public.vacation_transactions
      where employee_id = emp and accrual_key = key;
      if target <> existing then
        insert into public.vacation_transactions (employee_id, txn_type, amount, effective_date, period_start, accrual_key, reason)
        values (emp, 'allocation', target - existing,
                case when existing = 0 then greatest(ps, coverage_start) else today end, ps, key,
                case when existing = 0 then 'Annual vacation allocation' else 'Entitlement change true-up' end);
      end if;
    end if;
    cur := pe + 1;
  end loop;

  -- Progressive accrual: completed months only, entitlement/12 per month,
  -- prorated by days for partial months; cumulative rounding per vacation year.
  m_start := date_trunc('month', coverage_start)::date;
  m_period := null; prev_cum := 0; cum := 0;
  while (m_start + interval '1 month' - interval '1 day')::date < today loop
    m_end := (m_start + interval '1 month' - interval '1 day')::date;
    ent := private.entitlement_at(emp, m_end);
    select v.period_start into ps from public.vacation_period(emp, m_end) v;
    if m_period is distinct from ps then m_period := ps; cum := 0; prev_cum := 0; end if;
    if ent.id is not null and ent.allocation_method = 'accrual' then
      cum := cum + private.entitlement_integral(emp, greatest(m_start, coverage_start), m_end,
                                                (m_end - m_start + 1)) / 12.0;
      key := 'accrual:' || to_char(m_start, 'YYYY-MM');
      target := round(cum, 2) - round(prev_cum, 2);
      select coalesce(sum(amount), 0) into existing from public.vacation_transactions
      where employee_id = emp and accrual_key = key;
      if target <> existing then
        insert into public.vacation_transactions (employee_id, txn_type, amount, effective_date, period_start, accrual_key, reason)
        values (emp, 'accrual', target - existing, m_end, ps, key,
                'Vacation accrued for ' || to_char(m_start, 'FMMonth YYYY'));
      end if;
      prev_cum := cum;
    end if;
    m_start := (m_start + interval '1 month')::date;
  end loop;

  -- Year-end carryover cap (only if configured). Computed once per closed year.
  select carryover_cap_days into cap from public.agency_settings where id = 1;
  if cap is not null then
    cur := trk.tracking_start;
    loop
      select v.period_start, v.period_end into ps, pe from public.vacation_period(emp, cur) v;
      exit when pe >= today;
      key := 'forfeit:' || ps;
      select coalesce(sum(amount), 0) into bal from public.vacation_transactions
      where employee_id = emp and effective_date <= pe;
      if bal > cap and not exists (select 1 from public.vacation_transactions where employee_id = emp and accrual_key = key) then
        insert into public.vacation_transactions (employee_id, txn_type, amount, effective_date, period_start, accrual_key, reason)
        values (emp, 'carryover_forfeit', -(bal - cap), pe, ps, key,
                'Year-end carryover above the ' || cap || '-day cap');
      end if;
      cur := pe + 1;
    end loop;
  end if;
end;
$$;

create or replace function public.sync_my_vacation() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.sync_vacation(private.require_employee());
end;
$$;

-- ---------------------------------------------------------------------------
-- Balances
-- ---------------------------------------------------------------------------
create or replace function private.vacation_available(emp uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount), 0) from public.vacation_transactions where employee_id = emp;
$$;

create or replace function private.pending_days(emp uuid, k public.time_off_kind, cat public.lieu_category default null)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(days), 0) from public.time_off_requests
  where employee_id = emp and kind = k and status = 'pending'
    and (cat is null or lieu_category = cat);
$$;

create or replace function public.vacation_balance(emp uuid)
returns table (
  annual_entitlement numeric, year_type public.vacation_year_type, allocation_method public.allocation_method,
  period_start date, period_end date,
  opening numeric, carried_forward numeric, earned numeric, adjustments numeric,
  used numeric, booked numeric, pending numeric, available numeric, available_after_pending numeric
)
language plpgsql stable security definer set search_path = '' as $$
declare
  today date := private.today();
  ent public.vacation_entitlements;
  ps date; pe date;
begin
  if not (private.can_view_private(emp) or private.can_approve(emp)) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  ent := private.entitlement_at(emp, today);
  if ent.id is null then
    select * into ent from public.vacation_entitlements where employee_id = emp order by effective_from limit 1;
  end if;
  select v.period_start, v.period_end into ps, pe from public.vacation_period(emp, today) v;

  return query
  with t as (select * from public.vacation_transactions where employee_id = emp),
  d as (
    select rd.leave_date, rd.amount from public.time_off_request_days rd
    join public.time_off_requests r on r.id = rd.request_id
    where r.employee_id = emp and r.kind = 'vacation' and r.status = 'approved'
  )
  select ent.annual_days, ent.year_type, ent.allocation_method, ps, pe,
    (select coalesce(sum(amount), 0) from t where txn_type = 'opening_balance' and effective_date >= ps),
    (select coalesce(sum(amount), 0) from t where effective_date < ps or (txn_type = 'opening_carryover' and effective_date >= ps)),
    (select coalesce(sum(amount), 0) from t where txn_type in ('allocation', 'accrual') and effective_date between ps and pe),
    (select coalesce(sum(amount), 0) from t where txn_type in ('adjustment', 'carryover_forfeit') and effective_date between ps and pe),
    (select coalesce(sum(amount), 0) from d where leave_date between ps and least(pe, today)),
    (select coalesce(sum(amount), 0) from d where leave_date > today),
    private.pending_days(emp, 'vacation'),
    private.vacation_available(emp),
    private.vacation_available(emp) - private.pending_days(emp, 'vacation');
end;
$$;

create or replace function private.lieu_available(emp uuid, cat public.lieu_category) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount), 0) from public.lieu_transactions where employee_id = emp and category = cat;
$$;

create or replace function public.lieu_balance(emp uuid)
returns table (category public.lieu_category, earned numeric, used numeric, booked numeric,
               adjustments numeric, available numeric, pending_credits numeric, pending_usage numeric)
language plpgsql stable security definer set search_path = '' as $$
declare today date := private.today();
begin
  if not (private.can_view_private(emp) or private.can_approve(emp)) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return query
  select c.cat,
    (select coalesce(sum(amount), 0) from public.lieu_transactions t
       where t.employee_id = emp and t.category = c.cat and t.txn_type in ('credit', 'opening_balance')),
    (select coalesce(sum(rd.amount), 0) from public.time_off_request_days rd
       join public.time_off_requests r on r.id = rd.request_id
       where r.employee_id = emp and r.kind = 'lieu' and r.lieu_category = c.cat and r.status = 'approved' and rd.leave_date <= today),
    (select coalesce(sum(rd.amount), 0) from public.time_off_request_days rd
       join public.time_off_requests r on r.id = rd.request_id
       where r.employee_id = emp and r.kind = 'lieu' and r.lieu_category = c.cat and r.status = 'approved' and rd.leave_date > today),
    (select coalesce(sum(amount), 0) from public.lieu_transactions t
       where t.employee_id = emp and t.category = c.cat and t.txn_type in ('adjustment', 'expiry')),
    private.lieu_available(emp, c.cat),
    (select coalesce(sum(e.proposed_credit), 0) from public.lieu_work_entries e
       join public.lieu_submissions s on s.id = e.submission_id
       where e.employee_id = emp and e.category = c.cat and s.status in ('pending', 'changes_requested')),
    private.pending_days(emp, 'lieu', c.cat)
  from (values ('discretionary'::public.lieu_category), ('statutory'::public.lieu_category)) as c(cat);
end;
$$;

-- ---------------------------------------------------------------------------
-- Employee administration
-- ---------------------------------------------------------------------------
-- Ontario ESA minimum: 2 weeks (10 working days) under 5 years of service, 3 weeks at 5+.
create or replace function public.statutory_minimum_days(start_date date, as_of date) returns numeric
language sql immutable as $$
  select case when public.years_of_service(start_date, as_of) >= 5 then 15 else 10 end::numeric;
$$;

create or replace function public.admin_save_employee(payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_admin();
  emp uuid := nullif(payload ->> 'id', '')::uuid;
  old public.employee_profiles;
  new_role public.app_role := coalesce(payload ->> 'role', 'employee')::public.app_role;
  new_status public.employment_status := coalesce(payload ->> 'status', 'active')::public.employment_status;
  eff date;
  today date := private.today();
begin
  if emp is not null then
    select * into old from public.employee_profiles where id = emp for update;
    if old.id is null then raise exception 'Employee not found'; end if;
    if old.id = me and new_role <> old.role then
      raise exception 'You cannot change your own role. Ask another People Admin.' using errcode = '42501';
    end if;
    if old.id = me and new_status <> 'active' then
      raise exception 'You cannot deactivate yourself.' using errcode = '42501';
    end if;
    update public.employee_profiles set
      full_name = trim(payload ->> 'full_name'),
      work_email = lower(trim(payload ->> 'work_email')),
      job_title = nullif(trim(payload ->> 'job_title'), ''),
      department = nullif(trim(payload ->> 'department'), ''),
      start_date = (payload ->> 'start_date')::date,
      role = new_role,
      manager_id = nullif(payload ->> 'manager_id', '')::uuid,
      backup_approver_id = nullif(payload ->> 'backup_approver_id', '')::uuid,
      standard_day_hours = nullif(payload ->> 'standard_day_hours', '')::numeric
    where id = emp;
    if new_status <> old.status then
      perform public.admin_set_employee_status(emp, new_status);
    end if;
    perform private.sync_vacation(emp);
  else
    insert into public.employee_profiles (full_name, work_email, job_title, department, start_date, status, role,
                                          manager_id, backup_approver_id, standard_day_hours)
    values (trim(payload ->> 'full_name'), lower(trim(payload ->> 'work_email')),
            nullif(trim(payload ->> 'job_title'), ''), nullif(trim(payload ->> 'department'), ''),
            (payload ->> 'start_date')::date, new_status, new_role,
            nullif(payload ->> 'manager_id', '')::uuid, nullif(payload ->> 'backup_approver_id', '')::uuid,
            nullif(payload ->> 'standard_day_hours', '')::numeric)
    returning id into emp;

    -- Link an existing auth account with the same email, if any.
    update public.employee_profiles p set user_id = u.id
    from auth.users u where p.id = emp and lower(u.email) = p.work_email
      and not exists (select 1 from public.employee_profiles x where x.user_id = u.id);

    -- Default: track from the start date for people hired this calendar year (or
    -- later); otherwise from today, with the opening balance as of today.
    eff := coalesce(nullif(payload ->> 'entitlement_effective_from', '')::date,
                    case when (payload ->> 'start_date')::date >= date_trunc('year', today)::date
                         then (payload ->> 'start_date')::date else today end);
    insert into public.vacation_entitlements (employee_id, effective_from, annual_days, year_type, allocation_method, note, created_by)
    values (emp, eff,
            coalesce((payload ->> 'annual_days')::numeric, 10),
            coalesce(nullif(payload ->> 'year_type', '')::public.vacation_year_type,
                     (select default_vacation_year from public.agency_settings where id = 1)),
            coalesce(nullif(payload ->> 'allocation_method', '')::public.allocation_method,
                     (select default_allocation from public.agency_settings where id = 1)),
            'Initial contractual entitlement', me);

    -- New hire = starts on/after tracking start → prorated first-year allocation.
    insert into public.vacation_tracking (employee_id, tracking_start, is_new_hire)
    values (emp, eff, (payload ->> 'start_date')::date >= eff);

    if coalesce((payload ->> 'opening_vacation')::numeric, 0) <> 0 then
      insert into public.vacation_transactions (employee_id, txn_type, amount, effective_date, reason, created_by)
      values (emp, 'opening_balance', (payload ->> 'opening_vacation')::numeric, eff, 'Opening vacation balance', me);
    end if;
    if coalesce((payload ->> 'opening_carryover')::numeric, 0) <> 0 then
      insert into public.vacation_transactions (employee_id, txn_type, amount, effective_date, reason, created_by)
      values (emp, 'opening_carryover', (payload ->> 'opening_carryover')::numeric, eff, 'Carryover from previous vacation year', me);
    end if;
    if coalesce((payload ->> 'opening_lieu')::numeric, 0) <> 0 then
      insert into public.lieu_transactions (employee_id, category, txn_type, amount, effective_date, reason, created_by)
      values (emp, 'discretionary', 'opening_balance', (payload ->> 'opening_lieu')::numeric, eff, 'Opening lieu balance', me);
    end if;
    perform private.sync_vacation(emp);
  end if;

  if not exists (select 1 from public.employee_profiles where role = 'people_admin' and status = 'active') then
    raise exception 'At least one active People Admin is required';
  end if;
  return emp;
exception
  when unique_violation then
    raise exception 'An employee with this email already exists' using errcode = '23505';
end;
$$;

create or replace function public.admin_set_entitlement(emp uuid, effective_from date, annual_days numeric,
  year_type public.vacation_year_type, allocation_method public.allocation_method, note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_admin(); new_id uuid;
begin
  if annual_days < 0 then raise exception 'Entitlement cannot be negative'; end if;
  if nullif(trim(note), '') is null then raise exception 'Please record a reason for the change'; end if;
  insert into public.vacation_entitlements (employee_id, effective_from, annual_days, year_type, allocation_method, note, created_by)
  values (emp, effective_from, annual_days, year_type, allocation_method, note, me)
  returning id into new_id;
  perform private.sync_vacation(emp);
  perform private.notify(emp, 'entitlement_changed', 'Your vacation entitlement was updated',
    annual_days || ' days per year, effective ' || to_char(effective_from, 'FMMonth FMDD, YYYY'), '/time-off');
  return new_id;
exception when unique_violation then
  raise exception 'An entitlement already starts on this date. Choose another effective date.';
end;
$$;

create or replace function public.admin_adjust_balance(emp uuid, ledger text, amount numeric, reason text,
  category public.lieu_category default 'discretionary', effective_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_admin(); new_id uuid; d date := coalesce(effective_date, private.today());
begin
  if amount = 0 then raise exception 'Adjustment amount cannot be zero'; end if;
  if nullif(trim(reason), '') is null then raise exception 'A reason is required for every adjustment'; end if;
  if (amount * 2) <> trunc(amount * 2) and ledger = 'lieu' then
    raise exception 'Lieu adjustments must be in half-day increments';
  end if;
  if ledger = 'vacation' then
    insert into public.vacation_transactions (employee_id, txn_type, amount, effective_date, reason, created_by)
    values (emp, 'adjustment', amount, d, trim(reason), me) returning id into new_id;
  elsif ledger = 'lieu' then
    insert into public.lieu_transactions (employee_id, category, txn_type, amount, effective_date, reason, created_by)
    values (emp, category, 'adjustment', amount, d, trim(reason), me) returning id into new_id;
  else
    raise exception 'Unknown ledger %', ledger;
  end if;
  perform private.notify(emp, 'balance_adjusted', 'Your ' || ledger || ' balance was adjusted',
    (case when amount > 0 then '+' else '' end) || amount || ' day(s): ' || trim(reason), '/time-off');
  return new_id;
end;
$$;

create or replace function public.admin_set_employee_status(emp uuid, new_status public.employment_status)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_admin();
begin
  if emp = me and new_status = 'inactive' then raise exception 'You cannot deactivate yourself.'; end if;
  update public.employee_profiles
     set status = new_status,
         deactivated_at = case when new_status = 'inactive' then now() end
   where id = emp;
  if new_status = 'inactive' then
    -- Withdraw open items; history is preserved.
    update public.time_off_request_days set is_active = false
     where request_id in (select id from public.time_off_requests where employee_id = emp and status = 'pending');
    update public.time_off_requests set status = 'cancelled', cancelled_by = me, cancelled_at = now(),
           review_note = 'Withdrawn: employee deactivated'
     where employee_id = emp and status = 'pending';
    update public.lieu_work_entries set is_active = false
     where submission_id in (select id from public.lieu_submissions where employee_id = emp and status in ('pending', 'changes_requested'));
    update public.lieu_submissions set status = 'cancelled', review_note = 'Withdrawn: employee deactivated'
     where employee_id = emp and status in ('pending', 'changes_requested');
  end if;
  if not exists (select 1 from public.employee_profiles where role = 'people_admin' and status = 'active') then
    raise exception 'At least one active People Admin is required';
  end if;
end;
$$;

create or replace function public.admin_mark_invited(emp uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  update public.employee_profiles set invited_at = now() where id = emp;
end;
$$;

-- Approver lookup the employee is allowed to see (just names).
create or replace function public.my_approvers() returns table (id uuid, full_name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name from public.employee_profiles p
  where p.id in (select private.approver_ids(private.current_employee_id()));
$$;

-- Directory of active people for pickers (names only).
create or replace function public.people_directory() returns table (id uuid, full_name text, role public.app_role, job_title text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.role, p.job_title from public.employee_profiles p
  where p.status = 'active' and private.current_employee_id() is not null
    and (private.is_people_admin() or p.id = private.current_employee_id())
  order by p.full_name;
$$;

-- ===================== 20261023000004_time_off_workflow.sql =====================
-- Vacation & lieu-usage requests: day counting, submit, review, cancel.

-- Working days between two dates (excludes non-working weekdays and holidays).
create or replace function public.leave_days(start_date date, end_date date, portion public.day_portion default 'full')
returns table (leave_date date, amount numeric)
language sql stable security definer set search_path = '' as $$
  select d::date, case when portion = 'full' then 1.0 else 0.5 end
  from generate_series(start_date, end_date, interval '1 day') d
  where public.is_working_day(d::date)
    and (portion = 'full' or start_date = end_date)
    and end_date - start_date <= 366;
$$;

create or replace function private.has_overlap(emp uuid, s date, e date, portion public.day_portion, exclude_request uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.time_off_request_days d
    where d.employee_id = emp and d.is_active and d.leave_date between s and e
      and d.request_id is distinct from exclude_request
      and (d.portion = 'full' or has_overlap.portion = 'full' or d.portion = has_overlap.portion)
  );
$$;

-- Live preview for the request form.
create or replace function public.preview_time_off(start_date date, end_date date, portion public.day_portion default 'full')
returns table (days numeric, working_dates date[], holidays text[], overlaps boolean)
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(l.amount), 0),
         coalesce(array_agg(l.leave_date order by l.leave_date) filter (where l.leave_date is not null), '{}'),
         (select coalesce(array_agg(h.name || ' (' || to_char(h.holiday_date, 'Mon FMDD') || ')' order by h.holiday_date), '{}')
            from public.public_holidays h where h.holiday_date between start_date and end_date),
         private.has_overlap(private.current_employee_id(), start_date, end_date, portion)
  from public.leave_days(start_date, end_date, portion) l;
$$;

-- People (other than emp) away on any of the given dates — for coverage warnings.
create or replace function private.others_away(emp uuid, s date, e date)
returns table (leave_date date, people bigint, names text[])
language sql stable security definer set search_path = '' as $$
  select d.leave_date, count(distinct d.employee_id), array_agg(distinct p.full_name)
  from public.time_off_request_days d
  join public.time_off_requests r on r.id = d.request_id
  join public.employee_profiles p on p.id = d.employee_id
  where d.is_active and r.status = 'approved' and d.employee_id <> emp
    and d.leave_date between s and e and p.status = 'active'
  group by d.leave_date order by d.leave_date;
$$;

create or replace function public.submit_time_off(
  kind public.time_off_kind, start_date date, end_date date,
  portion public.day_portion default 'full', note text default null,
  lieu_category public.lieu_category default null, is_advance boolean default false,
  project_id uuid default null, for_employee uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_employee();
  emp uuid := coalesce(for_employee, me);
  req uuid;
  total numeric;
  avail numeric;
  half_ok boolean;
  cat public.lieu_category := case when kind = 'lieu' then coalesce(lieu_category, 'discretionary') end;
  emp_name text;
  label text;
begin
  if emp <> me then
    -- Leadership may record time off on someone's behalf (e.g. an advance lieu day).
    if not (private.is_people_admin() or private.can_approve(emp)) then
      raise exception 'Not authorised' using errcode = '42501';
    end if;
  end if;
  if end_date < start_date then raise exception 'End date must be on or after the start date'; end if;
  if end_date - start_date > 366 then raise exception 'Requests are limited to one year at a time'; end if;
  select allow_half_days into half_ok from public.agency_settings where id = 1;
  if portion <> 'full' and not half_ok then raise exception 'Half-day requests are turned off'; end if;
  if portion <> 'full' and start_date <> end_date then raise exception 'Half days must be a single date'; end if;
  if is_advance and (kind <> 'lieu' or project_id is null) then
    raise exception 'Advance lieu days must be linked to a project';
  end if;

  -- Serialise per employee so overlap/balance checks are race-free.
  perform 1 from public.employee_profiles where id = emp and status = 'active' for update;
  if not found then raise exception 'Employee is not active'; end if;

  select coalesce(sum(amount), 0) into total from public.leave_days(start_date, end_date, portion);
  if total = 0 then raise exception 'There are no working days in that date range'; end if;
  if private.has_overlap(emp, start_date, end_date, portion) then
    raise exception 'You already have time off requested on one or more of these dates';
  end if;

  if kind = 'lieu' and not is_advance then
    avail := private.lieu_available(emp, cat) - private.pending_days(emp, 'lieu', cat);
    if avail < total then
      raise exception 'Not enough lieu time: % day(s) available, % requested', avail, total;
    end if;
  end if;

  insert into public.time_off_requests (employee_id, kind, lieu_category, is_advance, project_id, start_date, end_date,
                                        portion, days, note, approver_id, created_by)
  values (emp, kind, cat, is_advance, project_id, start_date, end_date, portion, total, nullif(trim(note), ''),
          (select manager_id from public.employee_profiles where id = emp), me)
  returning id into req;

  insert into public.time_off_request_days (request_id, employee_id, leave_date, portion, amount)
  select req, emp, l.leave_date, portion, l.amount from public.leave_days(start_date, end_date, portion) l;

  insert into public.approval_records (subject_type, subject_id, subject_employee_id, action, actor_id, note)
  values ('time_off_request', req, emp, 'submitted', me, nullif(trim(note), ''));

  select full_name into emp_name from public.employee_profiles where id = emp;
  label := case when kind = 'vacation' then 'vacation' when is_advance then 'advance lieu day' else 'lieu time off' end;
  perform private.notify(emp, kind || '_submitted', 'Your ' || label || ' request was submitted',
    total || ' day(s), ' || to_char(start_date, 'Mon FMDD') ||
      case when end_date <> start_date then ' – ' || to_char(end_date, 'Mon FMDD') else '' end, '/time-off');
  perform private.notify(a, 'approval_needed', 'New ' || label || ' request from ' || emp_name,
    total || ' day(s), ' || to_char(start_date, 'Mon FMDD, YYYY') ||
      case when end_date <> start_date then ' – ' || to_char(end_date, 'Mon FMDD, YYYY') else '' end,
    '/leadership/requests')
  from private.approver_ids(emp) a where a <> me;
  return req;
end;
$$;

create or replace function public.review_time_off(request_id uuid, decision text, note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_employee();
  r public.time_off_requests;
  avail numeric;
  neg_ok boolean;
  label text;
begin
  if decision not in ('approved', 'declined') then raise exception 'Unknown decision %', decision; end if;
  -- Row lock: a concurrent reviewer waits, then sees the updated status.
  select * into r from public.time_off_requests where id = request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if not private.can_approve(r.employee_id) then
    raise exception 'You are not authorised to review this request' using errcode = '42501';
  end if;
  if r.status <> 'pending' then raise exception 'This request has already been %', r.status; end if;

  label := case when r.kind = 'vacation' then 'vacation' when r.is_advance then 'advance lieu day' else 'lieu time off' end;

  if decision = 'approved' then
    perform 1 from public.employee_profiles where id = r.employee_id for update;
    if r.kind = 'vacation' then
      perform private.sync_vacation(r.employee_id);
      select allow_negative_vacation into neg_ok from public.agency_settings where id = 1;
      avail := private.vacation_available(r.employee_id);
      if avail < r.days and not neg_ok then
        raise exception 'Insufficient vacation balance: % day(s) available, % requested', avail, r.days;
      end if;
      insert into public.vacation_transactions (employee_id, txn_type, amount, effective_date, request_id, reason, created_by)
      values (r.employee_id, 'usage', -r.days, r.start_date, r.id, 'Vacation ' || to_char(r.start_date, 'Mon FMDD, YYYY'), me);
    else
      avail := private.lieu_available(r.employee_id, r.lieu_category);
      if avail < r.days and not r.is_advance then
        raise exception 'Insufficient lieu balance: % day(s) available, % requested', avail, r.days;
      end if;
      insert into public.lieu_transactions (employee_id, category, txn_type, amount, effective_date, request_id, project_id, reason, created_by)
      values (r.employee_id, r.lieu_category, 'usage', -r.days, r.start_date, r.id, r.project_id,
              case when r.is_advance then 'Advance lieu day' else 'Lieu time off' end || ' ' || to_char(r.start_date, 'Mon FMDD, YYYY'), me);
    end if;
  else
    update public.time_off_request_days set is_active = false where time_off_request_days.request_id = r.id;
  end if;

  update public.time_off_requests
     set status = decision::public.request_status, reviewed_by = me, reviewed_at = now(), review_note = nullif(trim(review_time_off.note), '')
   where id = r.id;
  insert into public.approval_records (subject_type, subject_id, subject_employee_id, action, actor_id, note)
  values ('time_off_request', r.id, r.employee_id, decision, me, nullif(trim(note), ''));

  perform private.notify(r.employee_id, r.kind || '_' || decision,
    'Your ' || label || ' was ' || decision,
    r.days || ' day(s), ' || to_char(r.start_date, 'Mon FMDD') ||
      case when r.end_date <> r.start_date then ' – ' || to_char(r.end_date, 'Mon FMDD') else '' end ||
      coalesce(' · ' || nullif(trim(note), ''), ''), '/time-off');
end;
$$;

create or replace function public.cancel_time_off(request_id uuid, reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_employee();
  r public.time_off_requests;
  is_leader boolean;
begin
  select * into r from public.time_off_requests where id = request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  is_leader := private.is_people_admin() or private.can_approve(r.employee_id);
  if r.employee_id <> me and not is_leader then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if r.status not in ('pending', 'approved') then raise exception 'This request is already %', r.status; end if;
  if r.status = 'approved' and r.start_date <= private.today() and not is_leader then
    raise exception 'Time off that has already started can only be cancelled by leadership';
  end if;

  if r.status = 'approved' then
    if r.kind = 'vacation' then
      insert into public.vacation_transactions (employee_id, txn_type, amount, effective_date, request_id, reason, created_by)
      values (r.employee_id, 'usage_reversal', r.days, private.today(), r.id,
              'Cancelled vacation ' || to_char(r.start_date, 'Mon FMDD, YYYY'), me);
    else
      insert into public.lieu_transactions (employee_id, category, txn_type, amount, effective_date, request_id, project_id, reason, created_by)
      values (r.employee_id, r.lieu_category, 'usage_reversal', r.days, private.today(), r.id, r.project_id,
              'Cancelled lieu time off ' || to_char(r.start_date, 'Mon FMDD, YYYY'), me);
    end if;
  end if;

  update public.time_off_request_days set is_active = false where time_off_request_days.request_id = r.id;
  update public.time_off_requests set status = 'cancelled', cancelled_by = me, cancelled_at = now(),
         review_note = coalesce(nullif(trim(reason), ''), review_note)
   where id = r.id;
  insert into public.approval_records (subject_type, subject_id, subject_employee_id, action, actor_id, note)
  values ('time_off_request', r.id, r.employee_id, 'cancelled', me, nullif(trim(reason), ''));

  if r.employee_id <> me then
    perform private.notify(r.employee_id, r.kind || '_cancelled', 'Your time off was cancelled',
      to_char(r.start_date, 'Mon FMDD') || coalesce(' · ' || nullif(trim(reason), ''), ''), '/time-off');
  elsif r.status = 'approved' then
    perform private.notify(a, 'time_off_cancelled',
      (select full_name from public.employee_profiles where id = r.employee_id) || ' cancelled approved time off',
      to_char(r.start_date, 'Mon FMDD'), '/leadership/requests')
    from private.approver_ids(r.employee_id) a;
  end if;
end;
$$;

-- What an approver needs to decide: balances (approvers may see them), coverage.
create or replace function public.request_review_context(request_id uuid)
returns table (vacation_available numeric, vacation_pending numeric, lieu_available numeric, lieu_pending numeric,
               coverage jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare r public.time_off_requests;
begin
  select * into r from public.time_off_requests where id = request_id;
  if r.id is null or not (private.can_view_private(r.employee_id) or private.can_approve(r.employee_id)) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return query select
    private.vacation_available(r.employee_id),
    private.pending_days(r.employee_id, 'vacation'),
    private.lieu_available(r.employee_id, coalesce(r.lieu_category, 'discretionary')),
    private.pending_days(r.employee_id, 'lieu', coalesce(r.lieu_category, 'discretionary')),
    coalesce((select jsonb_agg(jsonb_build_object('date', o.leave_date, 'count', o.people, 'names', o.names))
              from private.others_away(r.employee_id, r.start_date, r.end_date) o), '[]'::jsonb);
end;
$$;

-- ===================== 20261023000005_lieu.sql =====================
-- Project-based lieu: rule evaluation, submissions, review, bulk entry.

create or replace function private.lieu_rule_for(d date) returns public.lieu_rule_versions
language sql stable security definer set search_path = '' as $$
  select * from public.lieu_rule_versions where effective_from <= d order by effective_from desc limit 1;
$$;

-- Proposed credit for one date. Internal RGXM guideline only — not a statutory
-- overtime determination. Public holidays are routed to People Admin review as
-- statutory (substitute day) entitlements.
create or replace function public.calc_lieu_credit(work_date date, hours numeric)
returns table (day_type public.lieu_day_type, proposed_credit numeric, category public.lieu_category,
               needs_review boolean, review_reason text, rule_version_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.lieu_rule_versions := private.lieu_rule_for(work_date);
  wd smallint[];
begin
  select working_days into wd from public.agency_settings where id = 1;
  rule_version_id := r.id;
  needs_review := false; category := 'discretionary';
  if public.is_holiday(work_date) then
    day_type := 'holiday';
    proposed_credit := 1;
    category := 'statutory';
    needs_review := true;
    review_reason := 'Public holiday worked: statutory entitlement (substitute day or premium pay). People Admin to confirm.';
  elsif not (extract(isodow from work_date)::smallint = any (wd)) then
    day_type := 'weekend';
    proposed_credit := case
      when hours >= r.weekend_full_min_hours then r.weekend_full_credit
      when hours >= r.weekend_half_min_hours then r.weekend_half_credit
      else 0 end;
  else
    day_type := 'weekday';
    if hours > r.weekday_review_above_hours then
      proposed_credit := r.weekday_credit;
      needs_review := true;
      review_reason := 'Over ' || trim(to_char(r.weekday_review_above_hours, 'FM99.##')) || ' hours on a workday: leadership review';
    elsif hours >= r.weekday_min_hours then
      proposed_credit := r.weekday_credit;
    else
      proposed_credit := 0;
    end if;
  end if;
  return next;
end;
$$;

create or replace function public.create_project(name text, client text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_employee(); pid uuid;
begin
  if nullif(trim(name), '') is null then raise exception 'Project name is required'; end if;
  select id into pid from public.projects where lower(trim(projects.name)) = lower(trim(create_project.name));
  if pid is not null then return pid; end if;
  insert into public.projects (name, client, created_by) values (trim(name), nullif(trim(client), ''), me) returning id into pid;
  return pid;
end;
$$;

create or replace function public.admin_update_project(project_id uuid, name text, client text, is_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  update public.projects set name = trim(admin_update_project.name), client = nullif(trim(admin_update_project.client), ''),
         is_active = admin_update_project.is_active
   where id = project_id;
end;
$$;

-- Insert entries for a submission; raises a friendly error on duplicate dates.
create or replace function private.insert_lieu_entries(sub uuid, emp uuid, proj uuid, entries jsonb)
returns numeric language plpgsql security definer set search_path = '' as $$
declare
  e jsonb; d date; h numeric; c record; total numeric := 0; review boolean := false; dup date;
begin
  if entries is null or jsonb_array_length(entries) = 0 then raise exception 'Add at least one date worked'; end if;
  select x.d into dup from (select (v ->> 'work_date')::date d from jsonb_array_elements(entries) v) x
  group by x.d having count(*) > 1 limit 1;
  if dup is not null then raise exception '% is listed more than once', to_char(dup, 'Dy Mon FMDD'); end if;

  for e in select * from jsonb_array_elements(entries) loop
    d := (e ->> 'work_date')::date;
    h := (e ->> 'hours')::numeric;
    if d is null or h is null then raise exception 'Each row needs a date and hours'; end if;
    if h <= 0 or h > 24 then raise exception 'Hours on % must be between 0 and 24', to_char(d, 'Mon FMDD'); end if;
    if d > private.today() then raise exception 'You can only log days that have already happened (% is in the future)', to_char(d, 'Mon FMDD'); end if;
    if exists (select 1 from public.lieu_work_entries w where w.employee_id = emp and w.work_date = d and w.is_active and w.submission_id <> sub) then
      raise exception 'Lieu has already been logged for % on %',
        (select full_name from public.employee_profiles where id = emp), to_char(d, 'Dy Mon FMDD, YYYY')
        using errcode = '23505';
    end if;
    select * into c from public.calc_lieu_credit(d, h);
    insert into public.lieu_work_entries (submission_id, employee_id, project_id, work_date, hours, day_type,
                                          rule_version_id, proposed_credit, category, needs_review, review_reason)
    values (sub, emp, proj, d, h, c.day_type, c.rule_version_id, c.proposed_credit, c.category, c.needs_review, c.review_reason);
    total := total + c.proposed_credit;
    review := review or c.needs_review;
  end loop;
  update public.lieu_submissions set total_proposed = total, needs_review = review where id = sub;
  return total;
end;
$$;

create or replace function public.submit_lieu(project_id uuid, entries jsonb, note text default null, resubmit_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_employee();
  sub uuid := resubmit_id;
  s public.lieu_submissions;
  total numeric;
  pname text;
begin
  select name into pname from public.projects where id = project_id and is_active;
  if pname is null then raise exception 'Choose an active project'; end if;
  perform 1 from public.employee_profiles where id = me for update;

  if sub is not null then
    select * into s from public.lieu_submissions where id = sub for update;
    if s.employee_id is distinct from me then raise exception 'Not authorised' using errcode = '42501'; end if;
    if s.status not in ('changes_requested', 'pending') then raise exception 'This submission can no longer be edited'; end if;
    delete from public.lieu_work_entries where submission_id = sub;
    update public.lieu_submissions set project_id = submit_lieu.project_id, status = 'pending', note = nullif(trim(submit_lieu.note), ''),
           reviewed_by = null, reviewed_at = null
     where id = sub;
  else
    insert into public.lieu_submissions (employee_id, project_id, note, submitted_by, approver_id)
    values (me, project_id, nullif(trim(note), ''), me, (select manager_id from public.employee_profiles where id = me))
    returning id into sub;
  end if;

  total := private.insert_lieu_entries(sub, me, project_id, entries);

  insert into public.approval_records (subject_type, subject_id, subject_employee_id, action, actor_id, note)
  values ('lieu_submission', sub, me, case when resubmit_id is null then 'submitted' else 'resubmitted' end, me, nullif(trim(note), ''));
  perform private.notify(me, 'lieu_submitted', 'Lieu submitted for ' || pname, total || ' day(s) proposed', '/time-off');
  perform private.notify(a, 'approval_needed',
    'New lieu submission from ' || (select full_name from public.employee_profiles where id = me),
    pname || ' · ' || total || ' day(s) proposed', '/leadership/lieu')
  from private.approver_ids(me) a;
  return sub;
end;
$$;

create or replace function public.cancel_lieu_submission(submission_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_employee(); s public.lieu_submissions;
begin
  select * into s from public.lieu_submissions where id = submission_id for update;
  if s.id is null or (s.employee_id <> me and not private.can_approve(s.employee_id)) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if s.status not in ('pending', 'changes_requested') then raise exception 'Only open submissions can be withdrawn'; end if;
  update public.lieu_work_entries set is_active = false where lieu_work_entries.submission_id = s.id;
  update public.lieu_submissions set status = 'cancelled' where id = s.id;
  insert into public.approval_records (subject_type, subject_id, subject_employee_id, action, actor_id)
  values ('lieu_submission', s.id, s.employee_id, 'cancelled', me);
end;
$$;

-- Post approved credits for a submission (entries must have approved_credit set).
create or replace function private.post_lieu_credits(sub uuid, actor uuid) returns numeric
language plpgsql security definer set search_path = '' as $$
declare total numeric;
begin
  insert into public.lieu_transactions (employee_id, category, txn_type, amount, effective_date, submission_id, project_id, reason, created_by)
  select e.employee_id, e.category, 'credit', e.approved_credit, e.work_date, e.submission_id, e.project_id,
         p.name || ' · ' || to_char(e.work_date, 'Dy Mon FMDD') || ' · ' || trim(to_char(e.hours, 'FM99.##')) || ' hrs', actor
  from public.lieu_work_entries e join public.projects p on p.id = e.project_id
  where e.submission_id = sub and e.approved_credit > 0;
  select coalesce(sum(approved_credit), 0) into total from public.lieu_work_entries where submission_id = sub;
  return total;
end;
$$;

-- decision: approved | declined | changes_requested
-- adjustments: [{ "entry_id": uuid, "approved_credit": 0|0.5|1|…, "category": "discretionary"|"statutory" }]
create or replace function public.review_lieu(submission_id uuid, decision text, note text default null,
                                              adjustments jsonb default '[]', adjustment_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_employee();
  s public.lieu_submissions;
  a jsonb; credit numeric; changed boolean := false; total numeric; pname text;
begin
  if decision not in ('approved', 'declined', 'changes_requested') then raise exception 'Unknown decision %', decision; end if;
  select * into s from public.lieu_submissions where id = submission_id for update;
  if s.id is null then raise exception 'Submission not found'; end if;
  if not private.can_approve(s.employee_id) then
    raise exception 'You are not authorised to review this submission' using errcode = '42501';
  end if;
  if s.status <> 'pending' then raise exception 'This submission has already been %', replace(s.status::text, '_', ' '); end if;
  select name into pname from public.projects where id = s.project_id;

  if decision = 'approved' then
    update public.lieu_work_entries set approved_credit = proposed_credit where lieu_work_entries.submission_id = s.id;
    for a in select * from jsonb_array_elements(coalesce(adjustments, '[]')) loop
      credit := (a ->> 'approved_credit')::numeric;
      if credit < 0 or credit > 2 or credit * 2 <> trunc(credit * 2) then
        raise exception 'Credits must be between 0 and 2 days in half-day steps';
      end if;
      update public.lieu_work_entries
         set approved_credit = credit,
             category = coalesce(nullif(a ->> 'category', '')::public.lieu_category, category)
       where id = (a ->> 'entry_id')::uuid and lieu_work_entries.submission_id = s.id
         and (approved_credit is distinct from credit or category::text is distinct from coalesce(nullif(a ->> 'category', ''), category::text));
      if found then changed := true; end if;
    end loop;
    if changed and nullif(trim(adjustment_reason), '') is null then
      raise exception 'Please give a reason when adjusting the proposed credit';
    end if;
    total := private.post_lieu_credits(s.id, me);
    update public.lieu_submissions set status = 'approved', total_approved = total, reviewed_by = me, reviewed_at = now(),
           review_note = nullif(trim(review_lieu.note), ''), adjustment_reason = case when changed then trim(review_lieu.adjustment_reason) end
     where id = s.id;
    if changed then
      insert into public.approval_records (subject_type, subject_id, subject_employee_id, action, actor_id, note)
      values ('lieu_submission', s.id, s.employee_id, 'adjusted', me, trim(adjustment_reason));
    end if;
    perform private.notify(s.employee_id, 'lieu_approved', 'Lieu credit approved: ' || pname,
      total || ' day(s) added to your lieu balance' || case when changed then ' (adjusted: ' || trim(adjustment_reason) || ')' else '' end,
      '/time-off');
  elsif decision = 'declined' then
    update public.lieu_work_entries set is_active = false where lieu_work_entries.submission_id = s.id;
    update public.lieu_submissions set status = 'declined', reviewed_by = me, reviewed_at = now(), review_note = nullif(trim(review_lieu.note), '')
     where id = s.id;
    perform private.notify(s.employee_id, 'lieu_declined', 'Lieu submission declined: ' || pname,
      coalesce(nullif(trim(note), ''), 'Talk to your manager for details'), '/time-off');
  else
    if nullif(trim(note), '') is null then raise exception 'Let them know what to change'; end if;
    update public.lieu_submissions set status = 'changes_requested', reviewed_by = me, reviewed_at = now(), review_note = trim(review_lieu.note)
     where id = s.id;
    perform private.notify(s.employee_id, 'lieu_changes_requested', 'Changes requested: ' || pname, trim(note),
      '/lieu/new?edit=' || s.id);
  end if;

  insert into public.approval_records (subject_type, subject_id, subject_employee_id, action, actor_id, note)
  values ('lieu_submission', s.id, s.employee_id, decision, me, nullif(trim(note), ''));
end;
$$;

-- Context shown to the reviewer: balance and any advance lieu days that
-- relate to this work (per RGXM's rule, only advance days offset a credit;
-- banked lieu and vacation do not).
create or replace function public.lieu_review_context(submission_id uuid)
returns table (lieu_available numeric, advance_days jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare s public.lieu_submissions; first_day date;
begin
  select * into s from public.lieu_submissions where id = submission_id;
  if s.id is null or not (private.can_view_private(s.employee_id) or private.can_approve(s.employee_id)) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select min(work_date) into first_day from public.lieu_work_entries where lieu_work_entries.submission_id = s.id;
  return query select
    private.lieu_available(s.employee_id, 'discretionary'),
    coalesce((select jsonb_agg(jsonb_build_object('start_date', r.start_date, 'days', r.days, 'status', r.status,
                                                  'same_project', r.project_id = s.project_id) order by r.start_date)
              from public.time_off_requests r
              where r.employee_id = s.employee_id and r.is_advance and r.status in ('approved', 'pending')
                and (r.project_id = s.project_id or r.start_date between first_day - 7 and first_day)), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Leadership bulk entry
-- rows: [{ "employee_id": uuid, "work_date": date, "hours": numeric }]
-- ---------------------------------------------------------------------------
create or replace function public.preview_bulk_lieu(project_id uuid, rows jsonb)
returns table (employee_id uuid, full_name text, work_date date, hours numeric, day_type public.lieu_day_type,
               proposed_credit numeric, needs_review boolean, review_reason text, conflict boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform private.require_admin();
  return query
  select (r ->> 'employee_id')::uuid, p.full_name, (r ->> 'work_date')::date, (r ->> 'hours')::numeric,
         c.day_type, c.proposed_credit, c.needs_review, c.review_reason,
         exists (select 1 from public.lieu_work_entries w where w.employee_id = (r ->> 'employee_id')::uuid
                 and w.work_date = (r ->> 'work_date')::date and w.is_active)
  from jsonb_array_elements(rows) r
  join public.employee_profiles p on p.id = (r ->> 'employee_id')::uuid
  cross join lateral public.calc_lieu_credit((r ->> 'work_date')::date, (r ->> 'hours')::numeric) c
  where coalesce((r ->> 'hours')::numeric, 0) > 0
  order by p.full_name, 3;
end;
$$;

create or replace function public.bulk_lieu(project_id uuid, rows jsonb, note text default null)
returns table (employee_id uuid, submission_id uuid, status public.lieu_submission_status, total numeric)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  me uuid := private.require_admin();
  emp uuid; sub uuid; t numeric; review boolean; pname text; entries jsonb;
begin
  select name into pname from public.projects where id = project_id and is_active;
  if pname is null then raise exception 'Choose an active project'; end if;

  for emp in
    select distinct (r ->> 'employee_id')::uuid from jsonb_array_elements(rows) r
    where coalesce((r ->> 'hours')::numeric, 0) > 0
  loop
    perform 1 from public.employee_profiles where id = emp and status = 'active' for update;
    if not found then raise exception 'One of the selected employees is not active'; end if;
    select jsonb_agg(r) into entries from jsonb_array_elements(rows) r
    where (r ->> 'employee_id')::uuid = emp and coalesce((r ->> 'hours')::numeric, 0) > 0;

    insert into public.lieu_submissions (employee_id, project_id, source, note, submitted_by, approver_id)
    values (emp, project_id, 'bulk', nullif(trim(note), ''), me, (select manager_id from public.employee_profiles where id = emp))
    returning id into sub;
    t := private.insert_lieu_entries(sub, emp, project_id, entries);
    select needs_review into review from public.lieu_submissions where id = sub;
    insert into public.approval_records (subject_type, subject_id, subject_employee_id, action, actor_id, note)
    values ('lieu_submission', sub, emp, 'submitted', me, 'Bulk entry by leadership');

    if review or not private.can_approve(emp) then
      -- Needs a human decision (flagged day, or the admin's own credit).
      perform private.notify(a, 'approval_needed', 'Lieu to review: ' || (select full_name from public.employee_profiles where id = emp),
        pname || ' · ' || t || ' day(s) proposed', '/leadership/lieu')
      from private.approver_ids(emp) a where a <> me;
      employee_id := emp; submission_id := sub; status := 'pending'; total := t;
    else
      update public.lieu_work_entries set approved_credit = proposed_credit where lieu_work_entries.submission_id = sub;
      t := private.post_lieu_credits(sub, me);
      update public.lieu_submissions set status = 'approved', total_approved = t, reviewed_by = me, reviewed_at = now()
       where id = sub;
      insert into public.approval_records (subject_type, subject_id, subject_employee_id, action, actor_id, note)
      values ('lieu_submission', sub, emp, 'approved', me, 'Bulk entry by leadership');
      perform private.notify(emp, 'lieu_approved', 'Lieu credit approved: ' || pname, t || ' day(s) added to your lieu balance', '/time-off');
      employee_id := emp; submission_id := sub; status := 'approved'; total := t;
    end if;
    return next;
  end loop;
end;
$$;

-- ===================== 20261023000006_settings_calendar_reports.sql =====================
-- Settings, holidays, calendar, dashboards, reports, notifications, maintenance.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create or replace function public.admin_save_settings(payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_admin();
begin
  update public.agency_settings s set
    agency_name = coalesce(nullif(trim(payload ->> 'agency_name'), ''), s.agency_name),
    timezone = coalesce(nullif(payload ->> 'timezone', ''), s.timezone),
    working_days = coalesce((select array_agg(x::smallint order by x::smallint) from jsonb_array_elements_text(payload -> 'working_days') x), s.working_days),
    standard_day_hours = coalesce((payload ->> 'standard_day_hours')::numeric, s.standard_day_hours),
    default_vacation_year = coalesce(nullif(payload ->> 'default_vacation_year', '')::public.vacation_year_type, s.default_vacation_year),
    default_allocation = coalesce(nullif(payload ->> 'default_allocation', '')::public.allocation_method, s.default_allocation),
    carryover_cap_days = case when payload ? 'carryover_cap_days' then nullif(payload ->> 'carryover_cap_days', '')::numeric else s.carryover_cap_days end,
    allow_negative_vacation = coalesce((payload ->> 'allow_negative_vacation')::boolean, s.allow_negative_vacation),
    allow_half_days = coalesce((payload ->> 'allow_half_days')::boolean, s.allow_half_days),
    lieu_expiry_months = case when payload ? 'lieu_expiry_months' then nullif(payload ->> 'lieu_expiry_months', '')::smallint else s.lieu_expiry_months end,
    coverage_warning_threshold = coalesce((payload ->> 'coverage_warning_threshold')::smallint, s.coverage_warning_threshold),
    anniversary_reminder_days = coalesce((select array_agg(x::smallint order by x::smallint desc) from jsonb_array_elements_text(payload -> 'anniversary_reminder_days') x), s.anniversary_reminder_days),
    absence_reminder_days = coalesce((payload ->> 'absence_reminder_days')::smallint, s.absence_reminder_days),
    email_notifications_enabled = coalesce((payload ->> 'email_notifications_enabled')::boolean, s.email_notifications_enabled),
    onboarding_completed = coalesce((payload ->> 'onboarding_completed')::boolean, s.onboarding_completed),
    updated_at = now(), updated_by = me
  where id = 1;
end;
$$;

-- New lieu rules never rewrite history: they create a version effective from a date.
create or replace function public.admin_save_lieu_rules(payload jsonb, effective_from date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_admin(); eff date := coalesce(effective_from, private.today()); vid uuid;
begin
  if eff < (select max(v.effective_from) from public.lieu_rule_versions v) then
    raise exception 'New rules must take effect on or after the current rules (%)',
      (select max(v.effective_from) from public.lieu_rule_versions v);
  end if;
  delete from public.lieu_rule_versions v where v.effective_from = eff
    and not exists (select 1 from public.lieu_work_entries w where w.rule_version_id = v.id);
  insert into public.lieu_rule_versions (effective_from, weekend_half_min_hours, weekend_half_credit, weekend_full_min_hours,
    weekend_full_credit, weekday_min_hours, weekday_credit, weekday_review_above_hours, require_approval, created_by)
  values (eff, (payload ->> 'weekend_half_min_hours')::numeric, (payload ->> 'weekend_half_credit')::numeric,
          (payload ->> 'weekend_full_min_hours')::numeric, (payload ->> 'weekend_full_credit')::numeric,
          (payload ->> 'weekday_min_hours')::numeric, (payload ->> 'weekday_credit')::numeric,
          (payload ->> 'weekday_review_above_hours')::numeric, coalesce((payload ->> 'require_approval')::boolean, true), me)
  returning id into vid;
  return vid;
exception when unique_violation then
  raise exception 'Rules already in use start on %. Choose a later effective date.', eff;
end;
$$;

create or replace function public.admin_add_holiday(holiday_date date, name text, kind public.holiday_kind default 'statutory')
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_admin(); hid uuid;
begin
  insert into public.public_holidays (holiday_date, name, kind, created_by)
  values (holiday_date, trim(name), kind, me) returning id into hid;
  return hid;
exception when unique_violation then
  raise exception 'There is already a holiday on %', holiday_date;
end;
$$;

create or replace function public.admin_delete_holiday(holiday_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  delete from public.public_holidays where id = holiday_id;
end;
$$;

-- Adds the nine Ontario public holidays for a year, plus an observed day off
-- when a holiday falls on a non-working day (ESA substitute holiday).
create or replace function private.generate_holidays(yr int) returns int
language plpgsql security definer set search_path = '' as $$
declare h record; obs date; n int := 0; wd smallint[];
begin
  select working_days into wd from public.agency_settings where id = 1;
  for h in select * from public.ontario_stat_holidays(yr) order by 1 loop
    insert into public.public_holidays (holiday_date, name, kind) values (h.holiday_date, h.name, 'statutory')
    on conflict (holiday_date) do nothing;
    if found then n := n + 1; end if;
  end loop;
  for h in select * from public.ontario_stat_holidays(yr) order by 1 loop
    if not (extract(isodow from h.holiday_date)::smallint = any (wd)) then
      obs := h.holiday_date + 1;
      while not (extract(isodow from obs)::smallint = any (wd))
            or exists (select 1 from public.public_holidays p where p.holiday_date = obs) loop
        obs := obs + 1;
      end loop;
      insert into public.public_holidays (holiday_date, name, kind) values (obs, h.name || ' (observed)', 'closure')
      on conflict (holiday_date) do nothing;
      if found then n := n + 1; end if;
    end if;
  end loop;
  return n;
end;
$$;

create or replace function public.admin_generate_holidays(yr int) returns int
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return private.generate_holidays(yr);
end;
$$;

select private.generate_holidays(y) from generate_series(2025, 2030) y;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create or replace function public.mark_notifications_read(ids uuid[] default null) returns void
language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now()
  where recipient_id = private.current_employee_id() and read_at is null
    and (ids is null or id = any (ids));
$$;

-- ---------------------------------------------------------------------------
-- Team calendar: colleagues appear only as name + "away" + dates.
-- Leave type, notes and pending requests are shown only to the employee
-- themselves, People Admins, and the employee's approvers.
-- ---------------------------------------------------------------------------
create or replace function public.team_calendar(from_date date, to_date date)
returns table (employee_id uuid, full_name text, leave_date date, portion public.day_portion,
               status public.request_status, kind text, is_self boolean, can_see_details boolean)
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := private.require_employee();
begin
  if to_date - from_date > 62 then raise exception 'Calendar range is limited to two months'; end if;
  return query
  select d.employee_id, p.full_name, d.leave_date, d.portion, r.status,
         case when private.can_view_private(d.employee_id) or private.can_approve(d.employee_id)
              then case when r.kind = 'vacation' then 'vacation' when r.is_advance then 'advance lieu' else 'lieu' end end,
         d.employee_id = me,
         private.can_view_private(d.employee_id) or private.can_approve(d.employee_id)
  from public.time_off_request_days d
  join public.time_off_requests r on r.id = d.request_id
  join public.employee_profiles p on p.id = d.employee_id
  where d.is_active and p.status = 'active'
    and d.leave_date between from_date and to_date
    and (r.status = 'approved'
         or (r.status = 'pending' and (private.can_view_private(d.employee_id) or private.can_approve(d.employee_id))))
  order by d.leave_date, p.full_name;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tenure & anniversaries
-- ---------------------------------------------------------------------------
create or replace function public.upcoming_anniversaries(within_days int default 90)
returns table (employee_id uuid, full_name text, job_title text, start_date date,
               anniversary date, years int, days_until int)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.job_title, p.start_date,
         public.next_anniversary(p.start_date, private.today()),
         public.years_of_service(p.start_date, public.next_anniversary(p.start_date, private.today())),
         public.next_anniversary(p.start_date, private.today()) - private.today()
  from public.employee_profiles p
  where p.status = 'active'
    and (private.is_people_admin() or private.can_approve(p.id) or p.id = private.current_employee_id())
    and public.next_anniversary(p.start_date, private.today()) - private.today() <= within_days
  order by 7, 2;
$$;

-- ---------------------------------------------------------------------------
-- Dashboards
-- ---------------------------------------------------------------------------
create or replace function public.approval_queue_counts()
returns table (pending_vacation bigint, pending_lieu_submissions bigint, pending_lieu_usage bigint)
language sql stable security definer set search_path = '' as $$
  select
    (select count(*) from public.time_off_requests r where r.status = 'pending' and r.kind = 'vacation' and private.can_approve(r.employee_id)),
    (select count(*) from public.lieu_submissions s where s.status = 'pending' and private.can_approve(s.employee_id)),
    (select count(*) from public.time_off_requests r where r.status = 'pending' and r.kind = 'lieu' and private.can_approve(r.employee_id));
$$;

create or replace function public.leadership_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare today date := private.today();
begin
  perform private.require_admin();
  return jsonb_build_object(
    'active_employees', (select count(*) from public.employee_profiles where status = 'active'),
    'pending_vacation', (select count(*) from public.time_off_requests where status = 'pending' and kind = 'vacation'),
    'pending_lieu_submissions', (select count(*) from public.lieu_submissions where status = 'pending'),
    'pending_lieu_usage', (select count(*) from public.time_off_requests where status = 'pending' and kind = 'lieu'),
    'away_today', coalesce((select jsonb_agg(distinct p.full_name) from public.time_off_request_days d
                             join public.time_off_requests r on r.id = d.request_id
                             join public.employee_profiles p on p.id = d.employee_id
                             where d.is_active and r.status = 'approved' and d.leave_date = today and p.status = 'active'), '[]'),
    'outstanding_lieu', (select coalesce(sum(t.amount), 0) from public.lieu_transactions t
                         join public.employee_profiles p on p.id = t.employee_id where p.status = 'active'),
    'anniversaries_90', (select count(*) from public.employee_profiles p where p.status = 'active'
                         and public.next_anniversary(p.start_date, today) - today <= 90)
  );
end;
$$;

create or replace function public.admin_employee_table()
returns table (id uuid, full_name text, work_email text, job_title text, department text, start_date date,
               status public.employment_status, role public.app_role, manager_name text,
               annual_days numeric, vacation_available numeric, lieu_available numeric,
               next_leave_start date, next_leave_end date, has_login boolean, invited_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare today date := private.today();
begin
  perform private.require_admin();
  return query
  select p.id, p.full_name, p.work_email, p.job_title, p.department, p.start_date, p.status, p.role, m.full_name,
         (private.entitlement_at(p.id, today)).annual_days,
         private.vacation_available(p.id),
         private.lieu_available(p.id, 'discretionary') + private.lieu_available(p.id, 'statutory'),
         nl.start_date, nl.end_date, p.user_id is not null, p.invited_at
  from public.employee_profiles p
  left join public.employee_profiles m on m.id = p.manager_id
  left join lateral (
    select r.start_date, r.end_date from public.time_off_requests r
    where r.employee_id = p.id and r.status = 'approved' and r.end_date >= today
    order by r.start_date limit 1
  ) nl on true
  order by p.status, p.full_name;
end;
$$;

-- Recent activity for a profile page / dashboard.
create or replace function public.recent_activity(emp uuid, max_rows int default 15)
returns table (occurred_at timestamptz, ledger text, description text, amount numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_view_private(emp) then raise exception 'Not authorised' using errcode = '42501'; end if;
  return query
  select * from (
    select t.created_at, 'vacation'::text,
           case t.txn_type when 'usage' then 'Vacation approved for ' || to_char(t.effective_date, 'Mon FMDD, YYYY')
             when 'adjustment' then 'Vacation balance adjusted: ' || coalesce(t.reason, '')
             else coalesce(t.reason, initcap(replace(t.txn_type::text, '_', ' '))) end,
           t.amount
    from public.vacation_transactions t where t.employee_id = emp
    union all
    select t.created_at, 'lieu',
           case t.txn_type when 'credit' then 'Lieu credit approved: ' || coalesce(t.reason, '')
             when 'adjustment' then 'Lieu balance adjusted: ' || coalesce(t.reason, '')
             else coalesce(t.reason, initcap(replace(t.txn_type::text, '_', ' '))) end,
           t.amount
    from public.lieu_transactions t where t.employee_id = emp
    union all
    select a.created_at, 'request',
           case a.action when 'submitted' then 'Request submitted' when 'resubmitted' then 'Request resubmitted'
             when 'declined' then 'Request declined' when 'changes_requested' then 'Changes requested'
             when 'cancelled' then 'Request cancelled' when 'approved' then 'Request approved' else 'Credit adjusted' end
           || case when a.subject_type = 'lieu_submission' then ' (lieu credit)'
                   else coalesce(' (' || (select r.kind::text || ', ' || to_char(r.start_date, 'Mon FMDD') from public.time_off_requests r where r.id = a.subject_id) || ')', '') end,
           null::numeric
    from public.approval_records a
    where a.subject_employee_id = emp and a.action in ('submitted', 'resubmitted', 'declined', 'changes_requested', 'cancelled')
  ) x order by 1 desc limit max_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reports (People Admin only)
-- ---------------------------------------------------------------------------
create or replace function public.report_vacation()
returns table (employee_id uuid, full_name text, status public.employment_status, annual_entitlement numeric,
               period_start date, period_end date, opening_balance numeric, carryover numeric, earned numeric,
               adjustments numeric, used numeric, booked numeric, pending numeric, available numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return query
  select p.id, p.full_name, p.status, b.annual_entitlement, b.period_start, b.period_end, b.opening, b.carried_forward,
         b.earned, b.adjustments, b.used, b.booked, b.pending, b.available
  from public.employee_profiles p cross join lateral public.vacation_balance(p.id) b
  order by p.status, p.full_name;
end;
$$;

create or replace function public.report_lieu(from_date date default null, to_date date default null)
returns table (employee_id uuid, full_name text, project text, work_date date, hours numeric, day_type public.lieu_day_type,
               category public.lieu_category, proposed_credit numeric, approved_credit numeric, status public.lieu_submission_status,
               lieu_used numeric, remaining_balance numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return query
  select p.id, p.full_name, pr.name, e.work_date, e.hours, e.day_type, e.category, e.proposed_credit, e.approved_credit, s.status,
         (select coalesce(-sum(t.amount), 0) from public.lieu_transactions t
           where t.employee_id = p.id and t.txn_type in ('usage', 'usage_reversal')),
         private.lieu_available(p.id, 'discretionary') + private.lieu_available(p.id, 'statutory')
  from public.lieu_work_entries e
  join public.lieu_submissions s on s.id = e.submission_id
  join public.employee_profiles p on p.id = e.employee_id
  join public.projects pr on pr.id = e.project_id
  where (from_date is null or e.work_date >= from_date) and (to_date is null or e.work_date <= to_date)
    and s.status not in ('cancelled')
  order by p.full_name, e.work_date;
end;
$$;

create or replace function public.report_project(project_id uuid)
returns table (employee_id uuid, full_name text, work_date date, hours numeric, day_type public.lieu_day_type,
               proposed_credit numeric, approved_credit numeric, status public.lieu_submission_status)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_variable
begin
  perform private.require_admin();
  return query
  select p.id, p.full_name, e.work_date, e.hours, e.day_type, e.proposed_credit, e.approved_credit, s.status
  from public.lieu_work_entries e
  join public.lieu_submissions s on s.id = e.submission_id
  join public.employee_profiles p on p.id = e.employee_id
  where e.project_id = report_project.project_id and s.status not in ('cancelled')
  order by e.work_date, p.full_name;
end;
$$;

-- ---------------------------------------------------------------------------
-- Daily maintenance: accruals/allocations/rollover, lieu expiry, reminders.
-- ---------------------------------------------------------------------------
create or replace function private.expire_lieu(emp uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  months smallint; cutoff date; consumed numeric; remaining numeric; c record; expiring numeric := 0;
begin
  select lieu_expiry_months into months from public.agency_settings where id = 1;
  if months is null then return; end if;
  cutoff := (private.today() - make_interval(months => months))::date;
  -- FIFO: everything that reduced the balance consumes the oldest credits first.
  select coalesce(-sum(amount), 0) into consumed from public.lieu_transactions
  where employee_id = emp and category = 'discretionary' and amount < 0;
  select consumed - coalesce(sum(amount), 0) into consumed from public.lieu_transactions
  where employee_id = emp and category = 'discretionary' and txn_type = 'usage_reversal';
  for c in select amount, effective_date from public.lieu_transactions
           where employee_id = emp and category = 'discretionary' and amount > 0 and txn_type <> 'usage_reversal'
           order by effective_date, created_at loop
    remaining := greatest(0, c.amount - greatest(consumed, 0));
    consumed := consumed - c.amount;
    if c.effective_date < cutoff then expiring := expiring + remaining; end if;
  end loop;
  if expiring > 0 then
    insert into public.lieu_transactions (employee_id, category, txn_type, amount, effective_date, reason)
    values (emp, 'discretionary', 'expiry', -expiring, private.today(), 'Unused lieu older than ' || months || ' months');
    perform private.notify(emp, 'lieu_expired', expiring || ' lieu day(s) expired', 'Lieu credits expire after ' || months || ' months', '/time-off');
  end if;
end;
$$;

create or replace function private.daily_maintenance() returns void
language plpgsql security definer set search_path = '' as $$
declare
  today date := private.today();
  s public.agency_settings;
  p record; off smallint; admin_id uuid; r record;
begin
  select * into s from public.agency_settings where id = 1;
  for p in select * from public.employee_profiles where status = 'active' loop
    perform private.sync_vacation(p.id);
    perform private.expire_lieu(p.id);
    -- Anniversary reminders to People Admins (and the employee's manager).
    foreach off in array s.anniversary_reminder_days loop
      if public.next_anniversary(p.start_date, today) - today = off then
        for admin_id in
          select id from public.employee_profiles where status = 'active' and role = 'people_admin' and id <> p.id
          union select p.manager_id where p.manager_id is not null
        loop
          perform private.notify(admin_id, 'anniversary',
            case when off = 0 then 'Today: ' else 'In ' || off || ' days: ' end || p.full_name || ' — ' ||
              public.years_of_service(p.start_date, public.next_anniversary(p.start_date, today)) || ' year work anniversary',
            to_char(public.next_anniversary(p.start_date, today), 'FMMonth FMDD'), '/leadership',
            'anniv:' || p.id || ':' || public.next_anniversary(p.start_date, today) || ':' || off || ':' || admin_id);
        end loop;
      end if;
    end loop;
  end loop;

  -- Upcoming absence reminders to approvers.
  for r in select tr.*, ep.full_name from public.time_off_requests tr join public.employee_profiles ep on ep.id = tr.employee_id
           where tr.status = 'approved' and tr.start_date = today + s.absence_reminder_days and ep.status = 'active' loop
    perform private.notify(a, 'upcoming_absence', r.full_name || ' is away from ' || to_char(r.start_date, 'Dy Mon FMDD'),
      r.days || ' day(s)', '/calendar', 'absence:' || r.id || ':' || a)
    from private.approver_ids(r.employee_id) a;
  end loop;

  -- Keep holidays generated two years ahead.
  perform private.generate_holidays(extract(year from today)::int + 1);
end;
$$;

create or replace function public.admin_run_maintenance() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  perform private.daily_maintenance();
end;
$$;

-- Schedule with pg_cron (06:15 Toronto ≈ 10:15 UTC; harmless if it runs twice).
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('rgxm-daily-maintenance', '15 10 * * *', 'select private.daily_maintenance()');
exception when others then
  raise notice 'pg_cron unavailable (%); call private.daily_maintenance() from an external scheduler', sqlerrm;
end $$;

-- Grants: every RPC above requires an authenticated session; checks are inside.
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on all functions in schema public from anon, public;
grant execute on function private.daily_maintenance() to service_role;
-- Internal helper (reveals start dates) — only used inside security-definer functions.
revoke execute on function public.vacation_period(uuid, date) from authenticated;

-- ===================== 20261023000007_ops.sql =====================
-- Operational helpers.

-- Link profiles to an existing auth account with the same email, whichever is created first.
create or replace function private.link_profile_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is null then
    select u.id into new.user_id from auth.users u
    where lower(u.email) = lower(new.work_email)
      and not exists (select 1 from public.employee_profiles p where p.user_id = u.id and p.id <> new.id);
  end if;
  return new;
end;
$$;
create trigger employee_profiles_link_user before insert or update of work_email on public.employee_profiles
  for each row execute function private.link_profile_user();

-- Entry point for an external scheduler (e.g. Vercel Cron) using the service role.
create or replace function public.cron_daily_maintenance() returns void
language sql security definer set search_path = '' as $$ select private.daily_maintenance(); $$;
revoke execute on function public.cron_daily_maintenance() from public, anon, authenticated;
grant execute on function public.cron_daily_maintenance() to service_role;

-- Notifications awaiting email delivery (service role only).
create or replace function public.pending_email_notifications(max_rows int default 100)
returns table (id uuid, email text, full_name text, title text, body text, link text)
language sql stable security definer set search_path = '' as $$
  select n.id, p.work_email, p.full_name, n.title, n.body, n.link
  from public.notifications n join public.employee_profiles p on p.id = n.recipient_id
  where n.emailed_at is null and n.created_at > now() - interval '2 days' and p.status = 'active'
    and (select email_notifications_enabled from public.agency_settings where id = 1)
  order by n.created_at limit max_rows;
$$;
create or replace function public.mark_notifications_emailed(ids uuid[]) returns void
language sql security definer set search_path = '' as $$
  update public.notifications set emailed_at = now() where id = any (ids);
$$;
revoke execute on function public.pending_email_notifications(int) from public, anon, authenticated;
revoke execute on function public.mark_notifications_emailed(uuid[]) from public, anon, authenticated;
grant execute on function public.pending_email_notifications(int) to service_role;
grant execute on function public.mark_notifications_emailed(uuid[]) to service_role;
