import { z } from 'zod';
import { sendLeaveDecisionEmail } from '@/lib/leave/email';
import { sendLeaveSmsNotification } from '@/lib/leave/sms';
import { authorizeReportRequest } from '@/lib/reports/authorization';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const submissionSchema = z.object({
  staffId: z.string().uuid(),
  pin: z.string().regex(/^\d{4}$/),
  leaveType: z.enum(['annual', 'sick']),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(500).default(''),
});
const decisionSchema = z.object({ requestId: z.string().uuid(), status: z.enum(['approved', 'rejected']) });

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
