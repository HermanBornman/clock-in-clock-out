create table if not exists public.management_hours_report_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  report_type text not null,
  report_date date not null,
  period_start date not null,
  period_end date not null,
  generated_at timestamptz not null default now(),
  recipient_email text not null,
  trigger text not null check (trigger in ('scheduled', 'manual')),
  status text not null check (status in ('sending', 'sent', 'failed')),
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (period_start <= period_end),
  unique (organization_id, report_type, report_date, recipient_email)
);

alter table public.management_hours_report_runs enable row level security;
drop policy if exists "Admins read management hours report runs" on public.management_hours_report_runs;
create policy "Admins read management hours report runs" on public.management_hours_report_runs for select to authenticated
  using (public.is_organization_admin(organization_id));

revoke all on public.management_hours_report_runs from public, anon;
grant select on public.management_hours_report_runs to authenticated;
grant all on public.management_hours_report_runs to service_role;

update public.weekly_report_settings set recipient_email = 'hr@pits.co.za';
update public.work_schedule set unpaid_break_minutes = 30 where day_of_week = 6;

notify pgrst, 'reload schema';
