create table if not exists public.leave_sms_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete restrict,
  leave_request_id uuid not null references public.leave_requests(id) on delete cascade,
  notification_type text not null check (notification_type in ('submitted_hr', 'approved_staff', 'rejected_staff')),
  recipient_last_four text check (recipient_last_four is null or recipient_last_four ~ '^[0-9]{4}$'),
  status text not null check (status in ('sending', 'sent', 'failed')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  provider_message_id text,
  provider_status text,
  error_message text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (leave_request_id, notification_type)
);
create index if not exists leave_sms_notifications_org_date_idx on public.leave_sms_notifications(organization_id, created_at desc);

create table if not exists public.leave_email_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete restrict,
  leave_request_id uuid not null references public.leave_requests(id) on delete cascade,
  notification_type text not null check (notification_type in ('approved_staff', 'rejected_staff')),
  status text not null check (status in ('sending', 'sent', 'failed')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  provider_message_id text,
  error_message text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (leave_request_id, notification_type)
);
create index if not exists leave_email_notifications_org_date_idx on public.leave_email_notifications(organization_id, created_at desc);

alter table public.leave_sms_notifications enable row level security;
alter table public.leave_email_notifications enable row level security;
drop policy if exists "Managers read branch leave SMS logs" on public.leave_sms_notifications;
create policy "Managers read branch leave SMS logs" on public.leave_sms_notifications for select to authenticated
  using (
    exists (
      select 1
      from public.memberships m
      where m.organization_id = leave_sms_notifications.organization_id
        and m.user_id = (select auth.uid())
        and m.active
        and (
          m.role = 'admin'
          or (
            m.role = 'manager'
            and exists (
              select 1
              from public.membership_stores ms
              where ms.organization_id = m.organization_id
                and ms.user_id = m.user_id
                and ms.store_id = leave_sms_notifications.store_id
            )
          )
        )
    )
  );

drop policy if exists "Administrators read leave email logs" on public.leave_email_notifications;
create policy "Administrators read leave email logs" on public.leave_email_notifications for select to authenticated
  using (public.is_organization_admin(organization_id));

revoke all on public.leave_sms_notifications, public.leave_email_notifications from public, anon;
grant select on public.leave_sms_notifications to authenticated;
grant select on public.leave_email_notifications to authenticated;
grant all on public.leave_sms_notifications, public.leave_email_notifications to service_role;
revoke execute on function public.staff_submit_leave(uuid, text, text, date, date, text) from public, anon, authenticated;
grant execute on function public.staff_submit_leave(uuid, text, text, date, date, text) to service_role;

drop policy if exists "Managers update leave" on public.leave_requests;
drop policy if exists "Admins update leave" on public.leave_requests;
create policy "Admins update leave" on public.leave_requests for update to authenticated
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

notify pgrst, 'reload schema';
