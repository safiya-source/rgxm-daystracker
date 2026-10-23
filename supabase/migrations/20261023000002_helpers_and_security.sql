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
