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
