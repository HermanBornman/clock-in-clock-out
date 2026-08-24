create extension if not exists pgcrypto;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  created_at timestamptz not null default now()
);

create table public.memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'manager')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index memberships_user_id_idx on public.memberships(user_id);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  location text not null,
  code text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);
create index stores_organization_id_idx on public.stores(organization_id);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete restrict,
  name text not null,
  role text not null,
  pin_last_two text check (pin_last_two ~ '^[0-9]{2}$'),
  pin_hash text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index staff_organization_id_idx on public.staff(organization_id);
create index staff_store_id_idx on public.staff(store_id);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete restrict,
  store_id uuid not null references public.stores(id) on delete restrict,
  work_date date not null default current_date,
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  status text not null default 'On time' check (status in ('On time', 'Late', 'Complete')),
  created_at timestamptz not null default now()
);
create index attendance_org_date_idx on public.attendance(organization_id, work_date desc);
create unique index attendance_open_shift_idx on public.attendance(staff_id) where clock_out is null;

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.stores enable row level security;
alter table public.staff enable row level security;
alter table public.attendance enable row level security;

create or replace function public.is_organization_member(org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships
    where organization_id = org_id and user_id = (select auth.uid())
  );
$$;

create or replace function public.is_organization_admin(org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships
    where organization_id = org_id and user_id = (select auth.uid()) and role = 'admin'
  );
$$;

create policy "Members read organizations" on public.organizations for select to authenticated using (public.is_organization_member(id));
create policy "Members read memberships" on public.memberships for select to authenticated using (public.is_organization_member(organization_id));
create policy "Admins manage memberships" on public.memberships for insert to authenticated with check (public.is_organization_admin(organization_id));
create policy "Admins update memberships" on public.memberships for update to authenticated using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id));
create policy "Members read stores" on public.stores for select to authenticated using (public.is_organization_member(organization_id));
create policy "Admins create stores" on public.stores for insert to authenticated with check (public.is_organization_admin(organization_id));
create policy "Admins update stores" on public.stores for update to authenticated using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id));
create policy "Members read staff" on public.staff for select to authenticated using (public.is_organization_member(organization_id));
create policy "Admins create staff" on public.staff for insert to authenticated with check (public.is_organization_admin(organization_id));
create policy "Admins update staff" on public.staff for update to authenticated using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id));
create policy "Members read attendance" on public.attendance for select to authenticated using (public.is_organization_member(organization_id));
create policy "Members create attendance" on public.attendance for insert to authenticated with check (public.is_organization_member(organization_id));
create policy "Members update attendance" on public.attendance for update to authenticated using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));

create or replace function public.bootstrap_organization(organization_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_org_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if exists (select 1 from public.memberships where user_id = (select auth.uid())) then raise exception 'User already has an organisation'; end if;
  insert into public.organizations(name) values (trim(organization_name)) returning id into new_org_id;
  insert into public.memberships(organization_id, user_id, role) values (new_org_id, (select auth.uid()), 'admin');
  return new_org_id;
end;
$$;

revoke execute on function public.bootstrap_organization(text) from public, anon;
revoke execute on function public.is_organization_member(uuid) from public, anon;
revoke execute on function public.is_organization_admin(uuid) from public, anon;
grant usage on schema public to authenticated;
grant select on public.organizations, public.memberships, public.stores, public.staff, public.attendance to authenticated;
grant insert, update on public.memberships, public.stores, public.staff, public.attendance to authenticated;
grant execute on function public.bootstrap_organization(text) to authenticated;
grant execute on function public.is_organization_member(uuid) to authenticated;
grant execute on function public.is_organization_admin(uuid) to authenticated;

notify pgrst, 'reload schema';
