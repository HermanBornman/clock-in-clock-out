create table if not exists public.weekly_report_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  recipient_email text not null default '',
  enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (recipient_email = '' or recipient_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

create table if not exists public.weekly_report_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  recipient_email text not null,
  status text not null check (status in ('sending', 'sent', 'failed')),
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (organization_id, week_start, recipient_email)
);

insert into public.weekly_report_settings(organization_id)
select id from public.organizations
on conflict (organization_id) do nothing;

alter table public.weekly_report_settings enable row level security;
alter table public.weekly_report_runs enable row level security;

drop policy if exists "Admins read weekly report settings" on public.weekly_report_settings;
create policy "Admins read weekly report settings" on public.weekly_report_settings for select to authenticated
  using (public.is_organization_admin(organization_id));
drop policy if exists "Admins update weekly report settings" on public.weekly_report_settings;
create policy "Admins update weekly report settings" on public.weekly_report_settings for update to authenticated
  using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id));
drop policy if exists "Admins read weekly report runs" on public.weekly_report_runs;
create policy "Admins read weekly report runs" on public.weekly_report_runs for select to authenticated
  using (public.is_organization_admin(organization_id));

revoke all on public.weekly_report_settings, public.weekly_report_runs from public, anon;
grant select, update on public.weekly_report_settings to authenticated;
grant select on public.weekly_report_runs to authenticated;

notify pgrst, 'reload schema';
