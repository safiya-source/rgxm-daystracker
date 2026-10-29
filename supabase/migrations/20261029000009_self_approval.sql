-- Optional per-person self-approval (e.g. a People Admin who may approve their
-- own time off in addition to their assigned approver). Off by default; only
-- People Admins can switch it on. Self-approvals are recorded like any other
-- approval (approval_records.actor_id = the employee).
alter table public.employee_profiles add column self_approval_allowed boolean not null default false;

create or replace function private.can_approve(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with me as (
    select id, role from public.employee_profiles
    where user_id = auth.uid() and status = 'active'
  ), t as (
    select id, role, manager_id, backup_approver_id, self_approval_allowed from public.employee_profiles where id = target
  )
  select coalesce((
    select case
      when t.id = me.id then t.self_approval_allowed
      else me.id in (t.manager_id, t.backup_approver_id)
        or (me.role = 'people_admin' and (
              t.role <> 'people_admin'
              or (t.manager_id is null and t.backup_approver_id is null)))
    end
    from me, t
  ), false);
$$;

create or replace function public.admin_set_self_approval(emp uuid, allowed boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  update public.employee_profiles set self_approval_allowed = allowed where id = emp;
  if not found then raise exception 'Employee not found'; end if;
end;
$$;
revoke execute on function public.admin_set_self_approval(uuid, boolean) from public, anon;
grant execute on function public.admin_set_self_approval(uuid, boolean) to authenticated;
