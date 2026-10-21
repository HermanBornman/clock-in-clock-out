create extension if not exists pg_cron with schema pg_catalog;

alter table public.attendance_adjustment_audit
  alter column adjusted_by drop not null;

alter table public.attendance drop constraint if exists attendance_record_source_check;
alter table public.attendance add constraint attendance_record_source_check
  check (record_source in ('employee_clocking', 'administrator_adjustment', 'system_auto_clock_out'));

alter table public.attendance drop constraint if exists attendance_adjustment_reason_check;
alter table public.attendance add constraint attendance_adjustment_reason_check
  check (
    record_source = 'employee_clocking'
    or char_length(trim(coalesce(adjustment_reason, ''))) between 3 and 500
  );

create or replace function public.auto_clock_out_saturday_shifts(
  p_reference_time timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_date date := (p_reference_time at time zone 'Africa/Johannesburg')::date;
  local_time time := (p_reference_time at time zone 'Africa/Johannesburg')::time;
  cutoff timestamptz;
  original public.attendance%rowtype;
  adjusted public.attendance%rowtype;
  adjusted_count integer := 0;
  reason_text constant text := 'Automatically clocked out at the Saturday 14:00 cutoff.';
begin
  if extract(isodow from local_date) <> 6 or local_time < time '14:00' then
    return 0;
  end if;

  cutoff := (local_date + time '14:00') at time zone 'Africa/Johannesburg';

  for original in
    select a.*
    from public.attendance a
    where a.work_date = local_date
      and a.clock_in is not null
      and a.clock_in <= cutoff
      and a.clock_out is null
    for update
  loop
    update public.attendance
    set clock_out = cutoff,
        status = 'Complete',
        record_source = 'system_auto_clock_out',
        adjustment_reason = reason_text,
        adjusted_by = null,
        adjusted_at = p_reference_time
    where id = original.id
    returning * into adjusted;

    insert into public.attendance_adjustment_audit(
      organization_id, store_id, attendance_id, adjusted_by,
      original_values, adjusted_values, reason
    ) values (
      original.organization_id, original.store_id, original.id, null,
      jsonb_build_object(
        'work_date', original.work_date, 'clock_in', original.clock_in,
        'clock_out', original.clock_out, 'status', original.status,
        'record_source', original.record_source
      ),
      jsonb_build_object(
        'work_date', adjusted.work_date, 'clock_in', adjusted.clock_in,
        'clock_out', adjusted.clock_out, 'status', adjusted.status,
        'record_source', adjusted.record_source
      ),
      reason_text
    );
    adjusted_count := adjusted_count + 1;
  end loop;

  return adjusted_count;
end;
$$;

revoke all on function public.auto_clock_out_saturday_shifts(timestamptz) from public, anon, authenticated;
grant execute on function public.auto_clock_out_saturday_shifts(timestamptz) to service_role;

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
  open_attendance public.attendance%rowtype;
  adjusted_attendance public.attendance%rowtype;
  event_time timestamptz := now();
  event_status text;
  scheduled_start time;
  saturday_cutoff timestamptz;
  reason_text constant text := 'Automatically clocked out at the Saturday 14:00 cutoff.';
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

  select a.* into open_attendance
  from public.attendance a
  where a.staff_id = p_staff_id and a.clock_out is null
  order by a.clock_in desc
  limit 1;

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
          'work_date', open_attendance.work_date, 'clock_in', open_attendance.clock_in,
          'clock_out', open_attendance.clock_out, 'status', open_attendance.status,
          'record_source', open_attendance.record_source
        ),
        jsonb_build_object(
          'work_date', adjusted_attendance.work_date, 'clock_in', adjusted_attendance.clock_in,
          'clock_out', adjusted_attendance.clock_out, 'status', adjusted_attendance.status,
          'record_source', adjusted_attendance.record_source
        ),
        reason_text
      );

      if p_action = 'out' then
        return query select true, 'Clock-out recorded at the Saturday 14:00 cutoff.', 'out'::text, saturday_cutoff, selected_staff.name, selected_store.name; return;
      end if;
      open_attendance.id := null;
    end if;
  end if;

  if p_action = 'in' then
    if open_attendance.id is not null then return query select false, 'You are already clocked in.', null::text, null::timestamptz, selected_staff.name, selected_store.name; return; end if;
    if extract(isodow from event_time at time zone 'Africa/Johannesburg') = 6
      and (event_time at time zone 'Africa/Johannesburg')::time >= time '14:00' then
      return query select false, 'Saturday clock-in closes at 14:00.', null::text, null::timestamptz, selected_staff.name, selected_store.name; return;
    end if;
    select ws.opens_at into scheduled_start from public.work_schedule ws
      where ws.organization_id = selected_staff.organization_id
        and ws.day_of_week = extract(isodow from event_time at time zone 'Africa/Johannesburg')::smallint;
    event_status := case when scheduled_start is not null and (event_time at time zone 'Africa/Johannesburg')::time > scheduled_start then 'Late' else 'On time' end;
    insert into public.attendance(organization_id, staff_id, store_id, work_date, clock_in, status)
      values (selected_staff.organization_id, selected_staff.id, selected_staff.store_id, (event_time at time zone 'Africa/Johannesburg')::date, event_time, event_status);
    return query select true, 'Clock-in recorded.', 'in'::text, event_time, selected_staff.name, selected_store.name; return;
  end if;

  if open_attendance.id is null then return query select false, 'You are not currently clocked in.', null::text, null::timestamptz, selected_staff.name, selected_store.name; return; end if;
  update public.attendance set clock_out = event_time, status = 'Complete' where id = open_attendance.id;
  return query select true, 'Clock-out recorded.', 'out'::text, event_time, selected_staff.name, selected_store.name;
end;
$$;

revoke all on function public.staff_clock(uuid, text, text) from public;
grant execute on function public.staff_clock(uuid, text, text) to anon, authenticated;

do $$
declare
  original public.attendance%rowtype;
  adjusted public.attendance%rowtype;
  cutoff timestamptz;
  reason_text constant text := 'Historical Saturday attendance capped at the 14:00 cutoff.';
begin
  for original in
    select a.*
    from public.attendance a
    where extract(isodow from a.work_date) = 6
      and a.work_date < (now() at time zone 'Africa/Johannesburg')::date
      and a.clock_in is not null
      and a.clock_in <= ((a.work_date + time '14:00') at time zone 'Africa/Johannesburg')
      and (a.clock_out is null or a.clock_out > ((a.work_date + time '14:00') at time zone 'Africa/Johannesburg'))
    for update
  loop
    cutoff := (original.work_date + time '14:00') at time zone 'Africa/Johannesburg';
    update public.attendance
    set clock_out = cutoff,
        status = 'Complete',
        record_source = 'system_auto_clock_out',
        adjustment_reason = reason_text,
        adjusted_by = null,
        adjusted_at = now()
    where id = original.id
    returning * into adjusted;

    insert into public.attendance_adjustment_audit(
      organization_id, store_id, attendance_id, adjusted_by,
      original_values, adjusted_values, reason
    ) values (
      original.organization_id, original.store_id, original.id, null,
      jsonb_build_object(
        'work_date', original.work_date, 'clock_in', original.clock_in,
        'clock_out', original.clock_out, 'status', original.status,
        'record_source', original.record_source
      ),
      jsonb_build_object(
        'work_date', adjusted.work_date, 'clock_in', adjusted.clock_in,
        'clock_out', adjusted.clock_out, 'status', adjusted.status,
        'record_source', adjusted.record_source
      ),
      reason_text
    );
  end loop;
end;
$$;

select cron.schedule(
  'saturday-auto-clock-out',
  '0 12 * * 6',
  'select public.auto_clock_out_saturday_shifts();'
);

notify pgrst, 'reload schema';
