create table if not exists public.staff_private_details (
  staff_id uuid primary key references public.staff(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text,
  contact_number text,
  sa_id_number text,
  tax_number text,
  start_date date,
  date_of_birth date,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  check (contact_number is null or char_length(contact_number) between 8 and 24),
  check (sa_id_number is null or sa_id_number ~ '^[0-9]{13}$'),
  check (tax_number is null or tax_number ~ '^[0-9]{10}$'),
  check ((sa_id_number is null and date_of_birth is null) or (sa_id_number is not null and date_of_birth is not null))
);

create unique index if not exists staff_private_details_org_id_number_idx
  on public.staff_private_details(organization_id, sa_id_number)
  where sa_id_number is not null;
create index if not exists staff_private_details_org_idx
  on public.staff_private_details(organization_id, staff_id);

create table if not exists public.staff_private_details_audit (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  changed_fields text[] not null,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists staff_private_details_audit_org_date_idx
  on public.staff_private_details_audit(organization_id, created_at desc);

alter table public.staff_private_details enable row level security;
alter table public.staff_private_details_audit enable row level security;

drop policy if exists "Admins read private staff details" on public.staff_private_details;
create policy "Admins read private staff details" on public.staff_private_details for select to authenticated
  using (public.is_organization_admin(organization_id));
drop policy if exists "Admins read private staff detail audit" on public.staff_private_details_audit;
create policy "Admins read private staff detail audit" on public.staff_private_details_audit for select to authenticated
  using (public.is_organization_admin(organization_id));

revoke all on public.staff_private_details, public.staff_private_details_audit from public, anon;
grant select on public.staff_private_details, public.staff_private_details_audit to authenticated;
grant all on public.staff_private_details, public.staff_private_details_audit to service_role;

create or replace function public.service_upsert_staff_private_details(
  p_staff_id uuid,
  p_organization_id uuid,
  p_email text,
  p_contact_number text,
  p_sa_id_number text,
  p_tax_number text,
  p_start_date date,
  p_date_of_birth date,
  p_updated_by uuid
)
returns public.staff_private_details
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous public.staff_private_details%rowtype;
  saved public.staff_private_details%rowtype;
  changed text[];
begin
  if not exists (
    select 1 from public.memberships m
    where m.organization_id = p_organization_id
      and m.user_id = p_updated_by
      and m.role = 'admin'
      and m.active
  ) then raise exception 'Administrator access required'; end if;

  if not exists (
    select 1 from public.staff s
    where s.id = p_staff_id and s.organization_id = p_organization_id
  ) then raise exception 'Staff member not found'; end if;

  select * into previous from public.staff_private_details where staff_id = p_staff_id;

  insert into public.staff_private_details (
    staff_id, organization_id, email, contact_number, sa_id_number,
    tax_number, start_date, date_of_birth, updated_by, updated_at
  ) values (
    p_staff_id, p_organization_id, nullif(lower(trim(p_email)), ''), nullif(trim(p_contact_number), ''),
    nullif(trim(p_sa_id_number), ''), nullif(trim(p_tax_number), ''), p_start_date,
    p_date_of_birth, p_updated_by, now()
  )
  on conflict (staff_id) do update set
    email = excluded.email,
    contact_number = excluded.contact_number,
    sa_id_number = excluded.sa_id_number,
    tax_number = excluded.tax_number,
    start_date = excluded.start_date,
    date_of_birth = excluded.date_of_birth,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning * into saved;

  changed := array_remove(array[
    case when previous.staff_id is null or previous.email is distinct from saved.email then 'email' end,
    case when previous.staff_id is null or previous.contact_number is distinct from saved.contact_number then 'contact_number' end,
    case when previous.staff_id is null or previous.sa_id_number is distinct from saved.sa_id_number then 'sa_id_number' end,
    case when previous.staff_id is null or previous.tax_number is distinct from saved.tax_number then 'tax_number' end,
    case when previous.staff_id is null or previous.start_date is distinct from saved.start_date then 'start_date' end,
    case when previous.staff_id is null or previous.date_of_birth is distinct from saved.date_of_birth then 'date_of_birth' end
  ], null);

  if cardinality(changed) > 0 then
    insert into public.staff_private_details_audit(staff_id, organization_id, changed_fields, updated_by)
    values (p_staff_id, p_organization_id, changed, p_updated_by);
  end if;
  return saved;
end;
$$;

revoke all on function public.service_upsert_staff_private_details(uuid, uuid, text, text, text, text, date, date, uuid) from public, anon, authenticated;
grant execute on function public.service_upsert_staff_private_details(uuid, uuid, text, text, text, text, date, date, uuid) to service_role;

notify pgrst, 'reload schema';
