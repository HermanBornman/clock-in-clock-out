create table if not exists public.daily_attendance_alert_runs (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  recipient_email text not null,
  status text not null check (status in ('sending', 'sent', 'failed')),
  late_count integer not null default 0 check (late_count >= 0),
  absent_count integer not null default 0 check (absent_count >= 0),
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (report_date, recipient_email)
);

alter table public.daily_attendance_alert_runs enable row level security;
revoke all on public.daily_attendance_alert_runs from public, anon, authenticated;
grant all on public.daily_attendance_alert_runs to service_role;

update public.organization_work_rules
set timezone = 'Africa/Johannesburg', ordinary_weekly_hours = 42.5;

update public.work_schedule
set opens_at = time '07:30', closes_at = time '17:00', unpaid_break_minutes = 60
where day_of_week between 1 and 5;

update public.work_schedule
set opens_at = time '08:00', closes_at = time '13:00', unpaid_break_minutes = 0
where day_of_week = 6;

notify pgrst, 'reload schema';
