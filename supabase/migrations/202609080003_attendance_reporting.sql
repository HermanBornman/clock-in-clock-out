alter table public.attendance alter column clock_in drop not null;
alter table public.attendance
  add column if not exists record_source text not null default 'employee_clocking',
  add column if not exists adjustment_reason text,
  add column if not exists adjusted_by uuid references auth.users(id) on delete set null,
  add column if not exists adjusted_at timestamptz;

alter table public.attendance drop constraint if exists attendance_status_check;
alter table public.attendance add constraint attendance_status_check check (status in ('On time', 'Late', 'Complete', 'Incomplete'));
alter table public.attendance drop constraint if exists attendance_record_source_check;
alter table public.attendance add constraint attendance_record_source_check check (record_source in ('employee_clocking', 'administrator_adjustment'));
alter table public.attendance drop constraint if exists attendance_adjustment_reason_check;
alter table public.attendance add constraint attendance_adjustment_reason_check check (record_source <> 'administrator_adjustment' or char_length(trim(coalesce(adjustment_reason, ''))) between 3 and 500);

drop index if exists public.attendance_open_shift_idx;
create unique index attendance_open_shift_idx on public.attendance(staff_id) where clock_in is not null and clock_out is null;
create index if not exists attendance_org_store_date_idx on public.attendance(organization_id, store_id, work_date desc);
create index if not exists attendance_staff_date_idx on public.attendance(staff_id, work_date desc);

create table if not exists public.attendance_adjustment_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete restrict,
  attendance_id uuid not null references public.attendance(id) on delete restrict,
  adjusted_by uuid not null references auth.users(id) on delete restrict,
  original_values jsonb not null,
  adjusted_values jsonb not null,
  reason text not null check (char_length(trim(reason)) between 3 and 500),
  created_at timestamptz not null default now()
);
create index if not exists attendance_adjustment_audit_record_idx on public.attendance_adjustment_audit(attendance_id, created_at desc);
create index if not exists attendance_adjustment_audit_org_date_idx on public.attendance_adjustment_audit(organization_id, created_at desc);

create table if not exists public.report_export_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_role text not null check (requested_role in ('admin', 'manager')),
  period_start date not null,
  period_end date not null,
  branch_ids uuid[] not null default '{}',
  filters jsonb not null default '{}',
  row_count integer not null check (row_count >= 0),
  file_name text not null,
  created_at timestamptz not null default now(),
  check (period_start <= period_end)
);
create index if not exists report_export_audit_org_date_idx on public.report_export_audit(organization_id, created_at desc);

alter table public.attendance_adjustment_audit enable row level security;
alter table public.report_export_audit enable row level security;

drop policy if exists "Managers read attendance adjustment audit" on public.attendance_adjustment_audit;
create policy "Managers read attendance adjustment audit" on public.attendance_adjustment_audit for select to authenticated
  using (public.can_access_store(organization_id, store_id));
drop policy if exists "Members read their report export audit" on public.report_export_audit;
create policy "Members read their report export audit" on public.report_export_audit for select to authenticated
  using (public.is_organization_admin(organization_id) or requested_by = (select auth.uid()));

revoke all on public.attendance_adjustment_audit, public.report_export_audit from public, anon;
grant select on public.attendance_adjustment_audit, public.report_export_audit to authenticated;
grant all on public.attendance_adjustment_audit, public.report_export_audit to service_role;

create or replace function public.apply_attendance_adjustment(
  p_attendance_id uuid,
  p_clock_in timestamptz,
  p_clock_out timestamptz,
  p_reason text,
  p_adjusted_by uuid
)
returns public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  original public.attendance%rowtype;
  adjusted public.attendance%rowtype;
begin
  if p_adjusted_by is null or char_length(trim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'A valid adjustment reason is required';
  end if;
  if p_clock_in is null and p_clock_out is null then raise exception 'At least one clock time is required'; end if;
  if p_clock_in is not null and p_clock_out is not null and p_clock_out <= p_clock_in then raise exception 'Clock-out must be after clock-in'; end if;
  select * into original from public.attendance where id = p_attendance_id for update;
  if not found then raise exception 'Attendance record not found'; end if;
  if not exists (select 1 from public.memberships m where m.organization_id = original.organization_id and m.user_id = p_adjusted_by and m.active and m.role in ('admin', 'manager')) then raise exception 'Administrator or manager access required'; end if;
  if not exists (select 1 from public.memberships m where m.organization_id = original.organization_id and m.user_id = p_adjusted_by and m.active and (m.role = 'admin' or exists (select 1 from public.membership_stores ms where ms.organization_id = m.organization_id and ms.user_id = m.user_id and ms.store_id = original.store_id))) then raise exception 'Branch access denied'; end if;
  update public.attendance set clock_in = p_clock_in, clock_out = p_clock_out, status = case when p_clock_in is null or p_clock_out is null then 'Incomplete' else 'Complete' end, record_source = 'administrator_adjustment', adjustment_reason = trim(p_reason), adjusted_by = p_adjusted_by, adjusted_at = now() where id = p_attendance_id returning * into adjusted;
  insert into public.attendance_adjustment_audit(organization_id, store_id, attendance_id, adjusted_by, original_values, adjusted_values, reason)
  values (original.organization_id, original.store_id, original.id, p_adjusted_by, jsonb_build_object('work_date', original.work_date, 'clock_in', original.clock_in, 'clock_out', original.clock_out, 'status', original.status, 'record_source', original.record_source), jsonb_build_object('work_date', adjusted.work_date, 'clock_in', adjusted.clock_in, 'clock_out', adjusted.clock_out, 'status', adjusted.status, 'record_source', adjusted.record_source), trim(p_reason));
  return adjusted;
end;
$$;

revoke all on function public.apply_attendance_adjustment(uuid, timestamptz, timestamptz, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_attendance_adjustment(uuid, timestamptz, timestamptz, text, uuid) to service_role;

notify pgrst, 'reload schema';
