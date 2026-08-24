create table if not exists public.clock_pin_attempts (
  id bigint generated always as identity primary key,
  staff_id uuid not null references public.staff(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  success boolean not null
);

create index if not exists clock_pin_attempts_staff_time_idx
  on public.clock_pin_attempts(staff_id, attempted_at desc);

alter table public.clock_pin_attempts enable row level security;

create or replace function public.clock_station_staff(p_store_code text)
returns table (
  store_id uuid,
  store_name text,
  store_location text,
  staff_id uuid,
  staff_name text,
  staff_role text,
  clocked_in boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.name,
    s.location,
    st.id,
    st.name,
    st.role,
    exists (
      select 1
      from public.attendance a
      where a.staff_id = st.id and a.clock_out is null
    )
  from public.stores s
  join public.staff st on st.store_id = s.id
  where s.active
    and st.active
    and s.code = upper(trim(p_store_code))
  order by st.name;
$$;

create or replace function public.staff_clock(
  p_staff_id uuid,
  p_pin text,
  p_action text
)
returns table (
  success boolean,
  message text,
  action text,
  occurred_at timestamptz,
  staff_name text,
  store_name text
)
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
begin
  if p_pin !~ '^[0-9]{4}$' or p_action not in ('in', 'out') then
    return query select false, 'Enter a valid four-digit PIN.', null::text, null::timestamptz, null::text, null::text;
    return;
  end if;

  select st.* into selected_staff
  from public.staff st
  where st.id = p_staff_id and st.active;

  if not found then
    return query select false, 'Staff profile is not available.', null::text, null::timestamptz, null::text, null::text;
    return;
  end if;

  select s.* into selected_store
  from public.stores s
  where s.id = selected_staff.store_id and s.active;

  if not found then
    return query select false, 'This store is not available.', null::text, null::timestamptz, null::text, null::text;
    return;
  end if;

  if (
    select count(*)
    from public.clock_pin_attempts cpa
    where cpa.staff_id = p_staff_id
      and not cpa.success
      and cpa.attempted_at > now() - interval '10 minutes'
  ) >= 5 then
    return query select false, 'Too many unsuccessful attempts. Try again in 10 minutes.', null::text, null::timestamptz, selected_staff.name, selected_store.name;
    return;
  end if;

  if selected_staff.pin_hash is null
    or extensions.crypt(p_pin, selected_staff.pin_hash) <> selected_staff.pin_hash then
    insert into public.clock_pin_attempts(staff_id, success) values (p_staff_id, false);
    return query select false, 'Incorrect PIN.', null::text, null::timestamptz, selected_staff.name, selected_store.name;
    return;
  end if;

  insert into public.clock_pin_attempts(staff_id, success) values (p_staff_id, true);

  select a.id into open_attendance_id
  from public.attendance a
  where a.staff_id = p_staff_id and a.clock_out is null
  order by a.clock_in desc
  limit 1;

  if p_action = 'in' then
    if open_attendance_id is not null then
      return query select false, 'You are already clocked in.', null::text, null::timestamptz, selected_staff.name, selected_store.name;
      return;
    end if;

    event_status := case
      when (event_time at time zone 'Africa/Johannesburg')::time > time '08:00' then 'Late'
      else 'On time'
    end;

    insert into public.attendance(
      organization_id, staff_id, store_id, work_date, clock_in, status
    ) values (
      selected_staff.organization_id,
      selected_staff.id,
      selected_staff.store_id,
      (event_time at time zone 'Africa/Johannesburg')::date,
      event_time,
      event_status
    );

    return query select true, 'Clock-in recorded.', 'in'::text, event_time, selected_staff.name, selected_store.name;
    return;
  end if;

  if open_attendance_id is null then
    return query select false, 'You are not currently clocked in.', null::text, null::timestamptz, selected_staff.name, selected_store.name;
    return;
  end if;

  update public.attendance
  set clock_out = event_time, status = 'Complete'
  where id = open_attendance_id;

  return query select true, 'Clock-out recorded.', 'out'::text, event_time, selected_staff.name, selected_store.name;
end;
$$;

revoke all on table public.clock_pin_attempts from public, anon, authenticated;
revoke execute on function public.clock_station_staff(text) from public;
revoke execute on function public.staff_clock(uuid, text, text) from public;
grant usage on schema public to anon, authenticated;
grant execute on function public.clock_station_staff(text) to anon, authenticated;
grant execute on function public.staff_clock(uuid, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
