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
