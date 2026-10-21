alter table public.staff
  add column if not exists overtime_eligible boolean not null default true;

create table if not exists public.daily_missing_clock_out_runs (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  recipient_email text not null,
  status text not null check (status in ('sending', 'sent', 'failed')),
  missing_count integer not null check (missing_count > 0),
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (report_date, recipient_email)
);

alter table public.daily_missing_clock_out_runs enable row level security;
revoke all on public.daily_missing_clock_out_runs from public, anon, authenticated;
grant all on public.daily_missing_clock_out_runs to service_role;

notify pgrst, 'reload schema';
