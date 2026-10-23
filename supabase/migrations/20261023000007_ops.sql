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
