-- Changing an entitlement on a date that already has one corrects that entry
-- (e.g. fixing a value entered during setup) instead of failing.
-- The previous values remain in audit_logs.
create or replace function public.admin_set_entitlement(emp uuid, effective_from date, annual_days numeric,
  year_type public.vacation_year_type, allocation_method public.allocation_method, note text)
returns uuid language plpgsql security definer set search_path = '' as $$
#variable_conflict use_variable
declare me uuid := private.require_admin(); new_id uuid;
begin
  if annual_days < 0 then raise exception 'Entitlement cannot be negative'; end if;
  if nullif(trim(note), '') is null then raise exception 'Please record a reason for the change'; end if;
  insert into public.vacation_entitlements as v (employee_id, effective_from, annual_days, year_type, allocation_method, note, created_by)
  values (emp, effective_from, annual_days, year_type, allocation_method, trim(note), me)
  on conflict on constraint vacation_entitlements_employee_id_effective_from_key do update
    set annual_days = excluded.annual_days, year_type = excluded.year_type,
        allocation_method = excluded.allocation_method, note = excluded.note, created_by = excluded.created_by
  returning v.id into new_id;
  perform private.sync_vacation(emp);
  perform private.notify(emp, 'entitlement_changed', 'Your vacation entitlement was updated',
    annual_days || ' days per year, effective ' || to_char(effective_from, 'FMMonth FMDD, YYYY'), '/time-off');
  return new_id;
end;
$$;
