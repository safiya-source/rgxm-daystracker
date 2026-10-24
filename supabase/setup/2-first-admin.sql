-- RGXM People: create the first People Admin.
-- 1. In Supabase → Authentication → Users → "Add user" → "Create new user",
--    enter the admin's email and a password, and tick "Auto Confirm User".
-- 2. Edit the three values below, paste this into SQL Editor and click Run.
--    (The profile is linked to the login automatically by matching email.)

with admin as (
  insert into public.employee_profiles (full_name, work_email, job_title, start_date, role)
  values ('YOUR FULL NAME', 'you@rgxm.com', 'YOUR JOB TITLE', '2020-01-01', 'people_admin')   -- ← edit (start date = YYYY-MM-DD)
  returning id
), ent as (
  insert into public.vacation_entitlements (employee_id, effective_from, annual_days, year_type, allocation_method, note)
  select id, (now() at time zone 'America/Toronto')::date, 15, 'calendar', 'upfront', 'Set during setup — update on your profile page'
  from admin
)
insert into public.vacation_tracking (employee_id, tracking_start)
select id, (now() at time zone 'America/Toronto')::date from admin;

-- Check: should show your name with linked = true
select full_name, role, user_id is not null as linked from public.employee_profiles;
