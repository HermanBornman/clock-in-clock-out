alter table public.staff
  add column if not exists archived_at timestamptz;

create index if not exists staff_active_directory_idx
  on public.staff(organization_id, store_id, name)
  where archived_at is null;

create or replace function public.service_set_staff_pin(p_staff_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must contain exactly four digits';
  end if;

  update public.staff
  set pin_last_two = right(p_pin, 2),
      pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf'))
  where id = p_staff_id;

  if not found then
    raise exception 'Staff member not found';
  end if;
end;
$$;

revoke all on function public.service_set_staff_pin(uuid, text) from public, anon, authenticated;
grant execute on function public.service_set_staff_pin(uuid, text) to service_role;

notify pgrst, 'reload schema';
