alter table public.memberships
  add column if not exists active boolean not null default true,
  add column if not exists invited_by uuid references auth.users(id) on delete set null,
  add column if not exists invited_at timestamptz,
  add column if not exists accepted_at timestamptz;

update public.memberships set accepted_at = coalesce(accepted_at, created_at) where accepted_at is null;

create table if not exists public.membership_stores (
  organization_id uuid not null,
  user_id uuid not null,
  store_id uuid not null references public.stores(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, store_id),
  foreign key (organization_id, user_id) references public.memberships(organization_id, user_id) on delete cascade
);
create index if not exists membership_stores_store_idx on public.membership_stores(store_id);
alter table public.membership_stores enable row level security;

create or replace function public.is_organization_member(org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships
    where organization_id = org_id and user_id = (select auth.uid()) and active
  );
$$;

create or replace function public.is_organization_admin(org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships
    where organization_id = org_id and user_id = (select auth.uid()) and role = 'admin' and active
  );
$$;

create or replace function public.can_access_store(org_id uuid, target_store_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org_id and m.user_id = (select auth.uid()) and m.active
      and (
        m.role = 'admin'
        or exists (
          select 1 from public.membership_stores ms
          where ms.organization_id = org_id and ms.user_id = m.user_id and ms.store_id = target_store_id
        )
      )
  );
$$;

create or replace function public.protect_final_administrator()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and old.active and tg_op = 'DELETE' and (
    select count(*) from public.memberships m
    where m.organization_id = old.organization_id and m.role = 'admin' and m.active
  ) <= 1 then
    raise exception 'The final active administrator cannot be removed or suspended';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active) and (
    select count(*) from public.memberships m
    where m.organization_id = old.organization_id and m.role = 'admin' and m.active
  ) <= 1 then
    raise exception 'The final active administrator cannot be removed or suspended';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_final_administrator_trigger on public.memberships;
create trigger protect_final_administrator_trigger
before update or delete on public.memberships
for each row execute function public.protect_final_administrator();

drop policy if exists "Members read memberships" on public.memberships;
create policy "Members read memberships" on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or public.is_organization_admin(organization_id));

drop policy if exists "Admins delete memberships" on public.memberships;
create policy "Admins delete memberships" on public.memberships for delete to authenticated
  using (public.is_organization_admin(organization_id));

drop policy if exists "Members read membership stores" on public.membership_stores;
create policy "Members read membership stores" on public.membership_stores for select to authenticated
  using (user_id = (select auth.uid()) or public.is_organization_admin(organization_id));
drop policy if exists "Admins manage membership stores" on public.membership_stores;
create policy "Admins manage membership stores" on public.membership_stores for all to authenticated
  using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id));

drop policy if exists "Members read stores" on public.stores;
create policy "Members read stores" on public.stores for select to authenticated
  using (public.can_access_store(organization_id, id));

drop policy if exists "Members read staff" on public.staff;
create policy "Members read staff" on public.staff for select to authenticated
  using (public.can_access_store(organization_id, store_id));

drop policy if exists "Members read attendance" on public.attendance;
create policy "Members read attendance" on public.attendance for select to authenticated
  using (public.can_access_store(organization_id, store_id));
drop policy if exists "Members create attendance" on public.attendance;
create policy "Members create attendance" on public.attendance for insert to authenticated
  with check (public.can_access_store(organization_id, store_id));
drop policy if exists "Members update attendance" on public.attendance;
create policy "Members update attendance" on public.attendance for update to authenticated
  using (public.can_access_store(organization_id, store_id)) with check (public.can_access_store(organization_id, store_id));

drop policy if exists "Members read leave" on public.leave_requests;
create policy "Members read leave" on public.leave_requests for select to authenticated
  using (public.can_access_store(organization_id, store_id));
drop policy if exists "Admins update leave" on public.leave_requests;
drop policy if exists "Managers update leave" on public.leave_requests;
create policy "Managers update leave" on public.leave_requests for update to authenticated
  using (public.can_access_store(organization_id, store_id)) with check (public.can_access_store(organization_id, store_id));

grant select, insert, update, delete on public.membership_stores to authenticated;
grant delete on public.memberships to authenticated;
grant execute on function public.can_access_store(uuid, uuid) to authenticated;
revoke execute on function public.can_access_store(uuid, uuid) from public, anon;

notify pgrst, 'reload schema';
