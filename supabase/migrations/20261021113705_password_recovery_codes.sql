create table if not exists public.password_recovery_requests (
  email_hash text primary key check (char_length(email_hash) = 64),
  last_requested_at timestamptz not null default now()
);

alter table public.password_recovery_requests enable row level security;

revoke all on table public.password_recovery_requests from anon, authenticated;
grant select, insert, update on table public.password_recovery_requests to service_role;
