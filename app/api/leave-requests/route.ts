import { z } from 'zod';
import { sendLeaveDecisionEmail } from '@/lib/leave/email';
import { sendLeaveSmsNotification } from '@/lib/leave/sms';
import { authorizeReportRequest } from '@/lib/reports/authorization';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const submissionSchema = z.object({
  staffId: z.string().uuid(),
  pin: z.string().regex(/^\d{4}$/),
  leaveType: z.enum(['annual', 'sick', 'family_responsibility']),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(500).default(''),
});
const decisionSchema = z.object({ requestId: z.string().uuid(), status: z.enum(['approved', 'rejected']) });
const administratorLeaveSchema = z.object({
  requestId: z.string().uuid().optional(),
  staffId: z.string().uuid(),
  leaveType: z.enum(['annual', 'sick', 'family_responsibility']),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(500).default(''),
});

type LeaveRow = {
  id: string;
  staff_id: string;
  store_id: string;
  leave_type: 'annual' | 'sick' | 'family_responsibility';
  start_date: string;
  end_date: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  manager_note: string | null;
  created_at: string;
};

function toLeaveRequest(row: LeaveRow) {
  return {
    id: row.id,
    staffId: row.staff_id,
    storeId: row.store_id,
    type: row.leave_type,
    startDate: row.start_date,
    endDate: row.end_date,
    reason: row.reason,
    status: row.status,
    managerNote: row.manager_note ?? undefined,
    createdAt: row.created_at,
  };
}

function inclusiveDayCount(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.floor((end - start) / 86_400_000) + 1;
}

export async function POST(request: Request) {
  const admin = createAdminClient();
  if (!admin) return Response.json({ error: 'Leave requests are not configured.' }, { status: 503 });
  const parsed = submissionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Enter valid leave request details.' }, { status: 400 });
  const input = parsed.data;
  const { data, error } = await admin.rpc('staff_submit_leave', {
    p_staff_id: input.staffId,
    p_pin: input.pin,
    p_leave_type: input.leaveType,
    p_start_date: input.startDate,
    p_end_date: input.endDate,
    p_reason: input.reason,
  });
  if (error) return Response.json({ error: 'Your request could not be sent. Please try again.' }, { status: 400 });
  const result = data?.[0] as { success?: boolean; message?: string; request_id?: string | null } | undefined;
  if (!result?.success || !result.request_id) return Response.json({ success: false, message: result?.message ?? 'Your request could not be sent.' }, { status: 400 });
  let smsSent = false;
  try { smsSent = (await sendLeaveSmsNotification(admin, result.request_id, 'submitted_hr')).sent; }
  catch { /* The leave request remains valid and the failed SMS is audited. */ }
  return Response.json({ success: true, message: result.message, requestId: result.request_id, smsSent }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await authorizeReportRequest(request);
  if (!auth.authorization) return auth.response!;
  if (auth.authorization.role !== 'admin') return Response.json({ error: 'Only authorised administrators may decide leave requests.' }, { status: 403 });
  const parsed = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Enter a valid leave decision.' }, { status: 400 });
  const { admin, organizationId, userId, allowedBranchIds } = auth.authorization;
  const { data: pending, error: readError } = await admin.from('leave_requests').select('id, store_id').eq('id', parsed.data.requestId).eq('organization_id', organizationId).eq('status', 'pending').maybeSingle();
  if (readError) return Response.json({ error: readError.message }, { status: 500 });
  if (!pending) return Response.json({ error: 'This leave request has already been decided or no longer exists.' }, { status: 409 });
  if (!allowedBranchIds.includes(String(pending.store_id))) return Response.json({ error: 'You do not have access to this branch.' }, { status: 403 });
  const { data: decided, error: updateError } = await admin.from('leave_requests').update({ status: parsed.data.status, decided_by: userId, decided_at: new Date().toISOString() }).eq('id', parsed.data.requestId).eq('organization_id', organizationId).eq('status', 'pending').select('id').maybeSingle();
  if (updateError) return Response.json({ error: updateError.message }, { status: 500 });
  if (!decided) return Response.json({ error: 'This leave request was decided by someone else.' }, { status: 409 });
  const [smsResult, emailResult] = await Promise.allSettled([
    sendLeaveSmsNotification(admin, parsed.data.requestId, parsed.data.status === 'approved' ? 'approved_staff' : 'rejected_staff'),
    sendLeaveDecisionEmail(admin, parsed.data.requestId, parsed.data.status),
  ]);
  const smsSent = smsResult.status === 'fulfilled' && smsResult.value.sent;
  const emailSent = emailResult.status === 'fulfilled' && emailResult.value.sent;
  return Response.json({ message: `Leave request ${parsed.data.status}.`, status: parsed.data.status, smsSent, emailSent });
}

export async function PUT(request: Request) {
  const auth = await authorizeReportRequest(request);
  if (!auth.authorization) return auth.response!;
  if (auth.authorization.role !== 'admin') {
    return Response.json({ error: 'Only authorised administrators may record or edit leave.' }, { status: 403 });
  }

  const parsed = administratorLeaveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Enter valid leave details.' }, { status: 400 });

  const input = parsed.data;
  const dayCount = inclusiveDayCount(input.startDate, input.endDate);
  if (!dayCount) return Response.json({ error: 'The leave end date must be on or after the start date.' }, { status: 400 });
  if (dayCount > 90) return Response.json({ error: 'A leave entry cannot cover more than 90 days.' }, { status: 400 });

  const { admin, organizationId, userId, allowedBranchIds } = auth.authorization;
  const { data: staff, error: staffError } = await admin
    .from('staff')
    .select('id, store_id')
    .eq('id', input.staffId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (staffError) return Response.json({ error: staffError.message }, { status: 500 });
  if (!staff) return Response.json({ error: 'Staff member not found.' }, { status: 404 });
  if (!allowedBranchIds.includes(String(staff.store_id))) {
    return Response.json({ error: 'You do not have access to this staff member’s branch.' }, { status: 403 });
  }

  let storeId = String(staff.store_id);
  if (input.requestId) {
    const { data: existing, error: existingError } = await admin
      .from('leave_requests')
      .select('id, staff_id, store_id')
      .eq('id', input.requestId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (existingError) return Response.json({ error: existingError.message }, { status: 500 });
    if (!existing) return Response.json({ error: 'Leave entry not found.' }, { status: 404 });
    if (!allowedBranchIds.includes(String(existing.store_id))) {
      return Response.json({ error: 'You do not have access to this leave entry’s branch.' }, { status: 403 });
    }
    if (String(existing.staff_id) === input.staffId) storeId = String(existing.store_id);
  }

  let overlapQuery = admin
    .from('leave_requests')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('staff_id', input.staffId)
    .in('status', ['pending', 'approved'])
    .lte('start_date', input.endDate)
    .gte('end_date', input.startDate)
    .limit(1);
  if (input.requestId) overlapQuery = overlapQuery.neq('id', input.requestId);
  const { data: overlaps, error: overlapError } = await overlapQuery;
  if (overlapError) return Response.json({ error: overlapError.message }, { status: 500 });
  if (overlaps?.length) {
    return Response.json({ error: 'This staff member already has pending or approved leave during these dates.' }, { status: 409 });
  }

  const values = {
    staff_id: input.staffId,
    store_id: storeId,
    leave_type: input.leaveType,
    start_date: input.startDate,
    end_date: input.endDate,
    reason: input.reason.trim(),
    status: 'approved' as const,
    manager_note: null,
    decided_by: userId,
    decided_at: new Date().toISOString(),
  };
  const columns = 'id, staff_id, store_id, leave_type, start_date, end_date, reason, status, manager_note, created_at';
  const result = input.requestId
    ? await admin.from('leave_requests').update(values).eq('id', input.requestId).eq('organization_id', organizationId).select(columns).maybeSingle()
    : await admin.from('leave_requests').insert({ ...values, organization_id: organizationId }).select(columns).single();
  if (result.error) return Response.json({ error: result.error.message }, { status: 500 });
  if (!result.data) return Response.json({ error: 'Leave entry could not be saved.' }, { status: 409 });

  return Response.json({
    message: input.requestId ? 'Leave entry updated.' : 'Past leave recorded and approved.',
    leaveRequest: toLeaveRequest(result.data as LeaveRow),
  });
}
