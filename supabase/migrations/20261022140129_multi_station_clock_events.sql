create table public.attendance_clock_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete restrict,
  staff_id uuid not null references public.staff(id) on delete cascade,
  attendance_id uuid not null references public.attendance(id) on delete cascade,
  action text not null check (action in ('in', 'out')),
  occurred_at timestamptz not null default now(),
  station_session_id uuid not null,
  request_id uuid not null unique
);

create index attendance_clock_events_staff_time_idx
  on public.attendance_clock_events(staff_id, occurred_at desc);

create index attendance_clock_events_store_time_idx
  on public.attendance_clock_events(store_id, occurred_at desc);

alter table public.attendance_clock_events enable row level security;

revoke all on table public.attendance_clock_events from public, anon, authenticated;
grant select, insert, update, delete on table public.attendance_clock_events to service_role;

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
      where a.staff_id = st.id
        and a.clock_in is not null
        and a.clock_out is null
    )
  from public.stores s
  join public.staff st on st.store_id = s.id
  where s.active
    and st.active
    and s.code = upper(trim(p_store_code))
  order by st.name;
$$;

revoke all on function public.clock_station_staff(text) from public;
grant execute on function public.clock_station_staff(text) to anon, authenticated;

create or replace function public.staff_clock_v2(
  p_staff_id uuid,
  p_pin text,
  p_station_session_id uuid,
  p_request_id uuid
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
  open_attendance public.attendance%rowtype;
  adjusted_attendance public.attendance%rowtype;
  recorded_attendance public.attendance%rowtype;
  existing_event public.attendance_clock_events%rowtype;
  event_time timestamptz := now();
  event_action text;
  event_status text;
  scheduled_start time;
  saturday_cutoff timestamptz;
  reason_text constant text := 'Automatically clocked out at the Saturday 14:00 cutoff.';
begin
  if p_pin !~ '^[0-9]{4}$' or p_station_session_id is null or p_request_id is null then
    return query select false, 'Enter a valid four-digit PIN.', null::text, null::timestamptz, null::text, null::text;
    return;
  end if;

  -- Lock the staff row so clock requests from multiple computers are processed
  -- one at a time for this employee.
  select st.* into selected_staff
  from public.staff st
  where st.id = p_staff_id and st.active
  for update;

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

  -- Replaying the same browser request is safe and returns its original result.
  select e.* into existing_event
  from public.attendance_clock_events e
  where e.request_id = p_request_id;

  if existing_event.id is not null then
    if existing_event.staff_id <> p_staff_id or existing_event.station_session_id <> p_station_session_id then
      return query select false, 'This clock request is not valid.', null::text, null::timestamptz, selected_staff.name, selected_store.name;
      return;
    end if;

    return query select
      true,
      case existing_event.action when 'in' then 'Clock-in recorded.' else 'Clock-out recorded.' end,
      existing_event.action,
      existing_event.occurred_at,
      selected_staff.name,
      selected_store.name;
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

  if selected_staff.pin_hash is null or extensions.crypt(p_pin, selected_staff.pin_hash) <> selected_staff.pin_hash then
    insert into public.clock_pin_attempts(staff_id, success) values (p_staff_id, false);
    return query select false, 'Incorrect PIN.', null::text, null::timestamptz, selected_staff.name, selected_store.name;
    return;
  end if;

  insert into public.clock_pin_attempts(staff_id, success) values (p_staff_id, true);

  select a.* into open_attendance
  from public.attendance a
  where a.staff_id = p_staff_id
    and a.clock_in is not null
    and a.clock_out is null
  order by a.clock_in desc
  limit 1
  for update;

  if open_attendance.id is not null and extract(isodow from open_attendance.work_date) = 6 then
    saturday_cutoff := (open_attendance.work_date + time '14:00') at time zone 'Africa/Johannesburg';

    if open_attendance.clock_in <= saturday_cutoff and event_time > saturday_cutoff then
      update public.attendance
      set clock_out = saturday_cutoff,
          status = 'Complete',
          record_source = 'system_auto_clock_out',
          adjustment_reason = reason_text,
          adjusted_by = null,
          adjusted_at = event_time
      where id = open_attendance.id
      returning * into adjusted_attendance;

      insert into public.attendance_adjustment_audit(
        organization_id, store_id, attendance_id, adjusted_by,
        original_values, adjusted_values, reason
      ) values (
        open_attendance.organization_id, open_attendance.store_id, open_attendance.id, null,
        jsonb_build_object(
          'work_date', open_attendance.work_date,
          'clock_in', open_attendance.clock_in,
          'clock_out', open_attendance.clock_out,
          'status', open_attendance.status,
          'record_source', open_attendance.record_source
        ),
        jsonb_build_object(
          'work_date', adjusted_attendance.work_date,
          'clock_in', adjusted_attendance.clock_in,
          'clock_out', adjusted_attendance.clock_out,
          'status', adjusted_attendance.status,
          'record_source', adjusted_attendance.record_source
        ),
        reason_text
      );

      open_attendance.id := null;
    end if;
  end if;

  if open_attendance.id is null then
    if extract(isodow from event_time at time zone 'Africa/Johannesburg') = 6
      and (event_time at time zone 'Africa/Johannesburg')::time >= time '14:00' then
      return query select false, 'Saturday clock-in closes at 14:00.', null::text, null::timestamptz, selected_staff.name, selected_store.name;
      return;
    end if;

    select ws.opens_at into scheduled_start
    from public.work_schedule ws
    where ws.organization_id = selected_staff.organization_id
      and ws.day_of_week = extract(isodow from event_time at time zone 'Africa/Johannesburg')::smallint;

    event_status := case
      when scheduled_start is not null
        and (event_time at time zone 'Africa/Johannesburg')::time > scheduled_start then 'Late'
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
    ) returning * into recorded_attendance;

    event_action := 'in';
  else
    update public.attendance
    set clock_out = event_time,
        status = 'Complete'
    where id = open_attendance.id
    returning * into recorded_attendance;

    event_action := 'out';
  end if;

  insert into public.attendance_clock_events(
    organization_id,
    store_id,
    staff_id,
    attendance_id,
    action,
    occurred_at,
    station_session_id,
    request_id
  ) values (
    selected_staff.organization_id,
    selected_staff.store_id,
    selected_staff.id,
    recorded_attendance.id,
    event_action,
    event_time,
    p_station_session_id,
    p_request_id
  );

  return query select
    true,
    case event_action when 'in' then 'Clock-in recorded.' else 'Clock-out recorded.' end,
    event_action,
    event_time,
    selected_staff.name,
    selected_store.name;
end;
$$;

revoke all on function public.staff_clock_v2(uuid, text, uuid, uuid) from public;
grant execute on function public.staff_clock_v2(uuid, text, uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
