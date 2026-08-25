-- Server routes use the Supabase service role through PostgREST. Explicit
-- grants are still required even though the role bypasses row-level security.
grant usage on schema public to service_role;

grant select, insert, update, delete on table
  public.organizations,
  public.memberships,
  public.membership_stores,
  public.stores,
  public.staff,
  public.attendance,
  public.clock_pin_attempts,
  public.organization_work_rules,
  public.work_schedule,
  public.public_holidays,
  public.leave_requests,
  public.weekly_report_settings,
  public.weekly_report_runs
to service_role;

notify pgrst, 'reload schema';
