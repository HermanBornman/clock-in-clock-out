alter table public.leave_requests
  drop constraint if exists leave_requests_leave_type_check;

alter table public.leave_requests
  add constraint leave_requests_leave_type_check
  check (leave_type in ('annual', 'sick', 'family_responsibility'));

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
  if p_pin !~ '^[0-9]{4}$' or p_leave_type not in ('annual', 'sick', 'family_responsibility') then
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
    case p_leave_type
      when 'annual' then 'Holiday request sent to your manager.'
      when 'sick' then 'Sick leave recorded for manager review.'
      else 'Family responsibility leave request sent to your manager.'
    end,
    new_request_id;
end;
$$;

revoke execute on function public.staff_submit_leave(uuid, text, text, date, date, text) from public;
grant execute on function public.staff_submit_leave(uuid, text, text, date, date, text) to anon, authenticated;

notify pgrst, 'reload schema';
