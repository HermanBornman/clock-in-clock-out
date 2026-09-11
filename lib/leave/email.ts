import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildStaffDecisionEmail } from '@/lib/leave/email-content';
import { isValidEmail, sendEmail } from '@/lib/notifications/email';

type Decision = 'approved' | 'rejected';

export async function sendLeaveDecisionEmail(admin: SupabaseClient, requestId: string, decision: Decision) {
  const type = decision === 'approved' ? 'approved_staff' : 'rejected_staff';
  const { data: leave, error: leaveError } = await admin.from('leave_requests')
    .select('id, organization_id, staff_id, store_id, leave_type, start_date, end_date')
    .eq('id', requestId).maybeSingle();
  if (leaveError || !leave) throw new Error(leaveError?.message ?? 'Leave request not found.');

  const { data: existing } = await admin.from('leave_email_notifications')
    .select('status, provider_message_id, attempt_count')
    .eq('leave_request_id', requestId).eq('notification_type', type).maybeSingle();
  if (existing?.status === 'sent') return { sent: true, skipped: true, messageId: existing.provider_message_id as string | null };
  if (existing?.status === 'sending') return { sent: false, skipped: true, messageId: null };

  const [{ data: staff }, { data: details }] = await Promise.all([
    admin.from('staff').select('name').eq('id', leave.staff_id).maybeSingle(),
    admin.from('staff_private_details').select('email').eq('staff_id', leave.staff_id).maybeSingle(),
  ]);
  const recipient = String(details?.email ?? '').trim().toLowerCase();
  const now = new Date().toISOString();
  const { error: logError } = await admin.from('leave_email_notifications').upsert({
    organization_id: leave.organization_id,
    store_id: leave.store_id,
    leave_request_id: requestId,
    notification_type: type,
    status: 'sending',
    attempt_count: Number(existing?.attempt_count ?? 0) + 1,
    error_message: null,
    completed_at: null,
    updated_at: now,
  }, { onConflict: 'leave_request_id,notification_type' });
  if (logError) throw new Error(logError.message);

  if (!isValidEmail(recipient)) {
    const message = 'The staff member has no valid email address.';
    await admin.from('leave_email_notifications').update({ status: 'failed', error_message: message, completed_at: now, updated_at: now }).eq('leave_request_id', requestId).eq('notification_type', type);
    throw new Error(message);
  }

  const content = buildStaffDecisionEmail(String(staff?.name ?? 'Staff member'), leave.leave_type, leave.start_date, leave.end_date, decision);
  try {
    const delivery = await sendEmail({ ...content, to: recipient, idempotencyKey: `leave-${type}-${requestId}` });
    const completedAt = new Date().toISOString();
    await admin.from('leave_email_notifications').update({ status: 'sent', provider_message_id: delivery.messageId, error_message: null, completed_at: completedAt, updated_at: completedAt }).eq('leave_request_id', requestId).eq('notification_type', type);
    return { sent: true, skipped: false, messageId: delivery.messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email delivery failed.';
    const completedAt = new Date().toISOString();
    await admin.from('leave_email_notifications').update({ status: 'failed', error_message: message.slice(0, 500), completed_at: completedAt, updated_at: completedAt }).eq('leave_request_id', requestId).eq('notification_type', type);
    throw error;
  }
}
