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
