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
