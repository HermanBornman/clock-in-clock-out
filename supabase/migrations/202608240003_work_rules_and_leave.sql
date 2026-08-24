create table if not exists public.organization_work_rules (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  timezone text not null default 'Africa/Johannesburg',
  ordinary_weekly_hours numeric(4,1) not null default 45,
  overtime_multiplier numeric(3,2) not null default 1.5,
  updated_at timestamptz not null default now()
);

create table if not exists public.work_schedule (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 1 and 7),
  opens_at time,
  closes_at time,
  unpaid_break_minutes smallint not null default 0 check (unpaid_break_minutes between 0 and 180),
  primary key (organization_id, day_of_week),
  check ((opens_at is null and closes_at is null) or (opens_at is not null and closes_at is not null and closes_at > opens_at))
);

create table if not exists public.public_holidays (
  holiday_date date primary key,
  name text not null,
  observed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete restrict,
  store_id uuid not null references public.stores(id) on delete restrict,
  leave_type text not null check (leave_type in ('annual', 'sick')),
  start_date date not null,
  end_date date not null,
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  manager_note text,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists leave_requests_org_status_idx
  on public.leave_requests(organization_id, status, start_date desc);
create index if not exists leave_requests_staff_idx
  on public.leave_requests(staff_id, start_date desc);

insert into public.organization_work_rules(organization_id)
select id from public.organizations
on conflict (organization_id) do nothing;

insert into public.work_schedule(organization_id, day_of_week, opens_at, closes_at, unpaid_break_minutes)
select o.id, d.day_of_week, d.opens_at, d.closes_at, d.break_minutes
from public.organizations o
cross join (values
  (1, time '07:30', time '17:00', 60),
  (2, time '07:30', time '17:00', 60),
  (3, time '07:30', time '17:00', 60),
  (4, time '07:30', time '17:00', 60),
  (5, time '07:30', time '17:00', 60),
  (6, time '08:00', time '13:00', 0),
  (7, null::time, null::time, 0)
) as d(day_of_week, opens_at, closes_at, break_minutes)
on conflict (organization_id, day_of_week) do nothing;

insert into public.public_holidays(holiday_date, name, observed) values
  ('2026-01-01', 'New Year''s Day', false),
  ('2026-03-21', 'Human Rights Day', false),
  ('2026-04-03', 'Good Friday', false),
  ('2026-04-06', 'Family Day', false),
  ('2026-04-27', 'Freedom Day', false),
  ('2026-05-01', 'Workers'' Day', false),
  ('2026-06-16', 'Youth Day', false),
  ('2026-08-09', 'National Women''s Day', false),
  ('2026-08-10', 'Public holiday observed for National Women''s Day', true),
  ('2026-09-24', 'Heritage Day', false),
  ('2026-12-16', 'Day of Reconciliation', false),
  ('2026-12-25', 'Christmas Day', false),
  ('2026-12-26', 'Day of Goodwill', false)
on conflict (holiday_date) do update set name = excluded.name, observed = excluded.observed;

alter table public.organization_work_rules enable row level security;
alter table public.work_schedule enable row level security;
alter table public.public_holidays enable row level security;
alter table public.leave_requests enable row level security;

drop policy if exists "Members read work rules" on public.organization_work_rules;
drop policy if exists "Admins update work rules" on public.organization_work_rules;
drop policy if exists "Members read schedule" on public.work_schedule;
drop policy if exists "Admins update schedule" on public.work_schedule;
drop policy if exists "Authenticated users read holidays" on public.public_holidays;
drop policy if exists "Members read leave" on public.leave_requests;
drop policy if exists "Admins update leave" on public.leave_requests;

create policy "Members read work rules" on public.organization_work_rules for select to authenticated
  using (public.is_organization_member(organization_id));
create policy "Admins update work rules" on public.organization_work_rules for update to authenticated
  using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id));
create policy "Members read schedule" on public.work_schedule for select to authenticated
  using (public.is_organization_member(organization_id));
create policy "Admins update schedule" on public.work_schedule for update to authenticated
  using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id));
create policy "Authenticated users read holidays" on public.public_holidays for select to authenticated using (true);
create policy "Members read leave" on public.leave_requests for select to authenticated
  using (public.is_organization_member(organization_id));
create policy "Admins update leave" on public.leave_requests for update to authenticated
  using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id));

create or replace function public.staff_submit_leave(
  p_staff_id uuid,
  p_pin text,
  p_leave_type text,
  p_start_date date,
  p_end_date date,
  p_reason text default ''
)
returns table (success boolean, message text, request_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_staff public.staff%rowtype;
  new_request_id uuid;
begin
  if p_pin !~ '^[0-9]{4}$' or p_leave_type not in ('annual', 'sick') then
    return query select false, 'Enter valid request details.', null::uuid;
    return;
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date or p_end_date > p_start_date + 90 then
    return query select false, 'Choose a valid date range of up to 90 days.', null::uuid;
    return;
  end if;

  select st.* into selected_staff from public.staff st where st.id = p_staff_id and st.active;
  if not found then
    return query select false, 'Incorrect PIN or staff profile.', null::uuid;
    return;
  end if;

  if (
    select count(*) from public.clock_pin_attempts cpa
    where cpa.staff_id = p_staff_id and not cpa.success
      and cpa.attempted_at > now() - interval '10 minutes'
  ) >= 5 then
    return query select false, 'Too many unsuccessful attempts. Try again in 10 minutes.', null::uuid;
    return;
  end if;

  if selected_staff.pin_hash is null
    or extensions.crypt(p_pin, selected_staff.pin_hash) <> selected_staff.pin_hash then
    insert into public.clock_pin_attempts(staff_id, success) values (p_staff_id, false);
    return query select false, 'Incorrect PIN or staff profile.', null::uuid;
    return;
  end if;
  insert into public.clock_pin_attempts(staff_id, success) values (p_staff_id, true);

  if exists (
    select 1 from public.leave_requests lr
    where lr.staff_id = p_staff_id and lr.status in ('pending', 'approved')
      and daterange(lr.start_date, lr.end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
  ) then
    return query select false, 'A leave request already exists for these dates.', null::uuid;
    return;
  end if;

  insert into public.leave_requests(organization_id, staff_id, store_id, leave_type, start_date, end_date, reason)
  values (selected_staff.organization_id, selected_staff.id, selected_staff.store_id, p_leave_type, p_start_date, p_end_date, left(trim(coalesce(p_reason, '')), 500))
  returning id into new_request_id;

  return query select true,
    case when p_leave_type = 'annual' then 'Holiday request sent to your manager.' else 'Sick leave recorded for manager review.' end,
    new_request_id;
end;
$$;

create or replace function public.bootstrap_organization(organization_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_org_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if exists (select 1 from public.memberships where user_id = (select auth.uid())) then raise exception 'User already has an organisation'; end if;
  insert into public.organizations(name) values (trim(organization_name)) returning id into new_org_id;
  insert into public.memberships(organization_id, user_id, role) values (new_org_id, (select auth.uid()), 'admin');
  insert into public.organization_work_rules(organization_id) values (new_org_id);
  insert into public.work_schedule(organization_id, day_of_week, opens_at, closes_at, unpaid_break_minutes) values
    (new_org_id, 1, '07:30', '17:00', 60), (new_org_id, 2, '07:30', '17:00', 60),
    (new_org_id, 3, '07:30', '17:00', 60), (new_org_id, 4, '07:30', '17:00', 60),
    (new_org_id, 5, '07:30', '17:00', 60), (new_org_id, 6, '08:00', '13:00', 0),
    (new_org_id, 7, null, null, 0);
  return new_org_id;
end;
$$;

create or replace function public.staff_clock(
  p_staff_id uuid,
  p_pin text,
  p_action text
)
returns table (success boolean, message text, action text, occurred_at timestamptz, staff_name text, store_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_staff public.staff%rowtype;
  selected_store public.stores%rowtype;
  open_attendance_id uuid;
  event_time timestamptz := now();
  event_status text;
  scheduled_start time;
begin
  if p_pin !~ '^[0-9]{4}$' or p_action not in ('in', 'out') then
    return query select false, 'Enter a valid four-digit PIN.', null::text, null::timestamptz, null::text, null::text; return;
  end if;
  select st.* into selected_staff from public.staff st where st.id = p_staff_id and st.active;
  if not found then return query select false, 'Staff profile is not available.', null::text, null::timestamptz, null::text, null::text; return; end if;
  select s.* into selected_store from public.stores s where s.id = selected_staff.store_id and s.active;
  if not found then return query select false, 'This store is not available.', null::text, null::timestamptz, null::text, null::text; return; end if;
  if (select count(*) from public.clock_pin_attempts cpa where cpa.staff_id = p_staff_id and not cpa.success and cpa.attempted_at > now() - interval '10 minutes') >= 5 then
    return query select false, 'Too many unsuccessful attempts. Try again in 10 minutes.', null::text, null::timestamptz, selected_staff.name, selected_store.name; return;
  end if;
  if selected_staff.pin_hash is null or extensions.crypt(p_pin, selected_staff.pin_hash) <> selected_staff.pin_hash then
    insert into public.clock_pin_attempts(staff_id, success) values (p_staff_id, false);
    return query select false, 'Incorrect PIN.', null::text, null::timestamptz, selected_staff.name, selected_store.name; return;
  end if;
  insert into public.clock_pin_attempts(staff_id, success) values (p_staff_id, true);
  select a.id into open_attendance_id from public.attendance a where a.staff_id = p_staff_id and a.clock_out is null order by a.clock_in desc limit 1;
  if p_action = 'in' then
    if open_attendance_id is not null then return query select false, 'You are already clocked in.', null::text, null::timestamptz, selected_staff.name, selected_store.name; return; end if;
    select ws.opens_at into scheduled_start from public.work_schedule ws
      where ws.organization_id = selected_staff.organization_id
        and ws.day_of_week = extract(isodow from event_time at time zone 'Africa/Johannesburg')::smallint;
    event_status := case when scheduled_start is not null and (event_time at time zone 'Africa/Johannesburg')::time > scheduled_start then 'Late' else 'On time' end;
    insert into public.attendance(organization_id, staff_id, store_id, work_date, clock_in, status)
      values (selected_staff.organization_id, selected_staff.id, selected_staff.store_id, (event_time at time zone 'Africa/Johannesburg')::date, event_time, event_status);
    return query select true, 'Clock-in recorded.', 'in'::text, event_time, selected_staff.name, selected_store.name; return;
  end if;
  if open_attendance_id is null then return query select false, 'You are not currently clocked in.', null::text, null::timestamptz, selected_staff.name, selected_store.name; return; end if;
  update public.attendance set clock_out = event_time, status = 'Complete' where id = open_attendance_id;
  return query select true, 'Clock-out recorded.', 'out'::text, event_time, selected_staff.name, selected_store.name;
end;
$$;

revoke all on public.organization_work_rules, public.work_schedule, public.public_holidays, public.leave_requests from public, anon;
grant select on public.organization_work_rules, public.work_schedule, public.public_holidays, public.leave_requests to authenticated;
grant update on public.organization_work_rules, public.work_schedule, public.leave_requests to authenticated;
revoke execute on function public.staff_submit_leave(uuid, text, text, date, date, text) from public;
grant execute on function public.staff_submit_leave(uuid, text, text, date, date, text) to anon, authenticated;

notify pgrst, 'reload schema';
