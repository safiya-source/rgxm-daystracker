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
