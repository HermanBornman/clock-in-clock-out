import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildHrLeaveMessage, buildStaffDecisionMessage } from '@/lib/leave/sms-content';
import { normalizeSouthAfricanMobile } from '@/lib/notifications/sms-format';
import { sendSms } from '@/lib/notifications/sms';

export { buildHrLeaveMessage, buildStaffDecisionMessage } from '@/lib/leave/sms-content';

type NotificationType = 'submitted_hr' | 'approved_staff' | 'rejected_staff';
type LeaveRecord = {
  id: string;
  organization_id: string;
  staff_id: string;
  store_id: string;
  leave_type: 'annual' | 'sick';
  start_date: string;
  end_date: string;
  status: 'pending' | 'approved' | 'rejected';
};

export async function sendLeaveSmsNotification(admin: SupabaseClient, requestId: string, type: NotificationType) {
  const { data: leave, error: leaveError } = await admin.from('leave_requests')
    .select('id, organization_id, staff_id, store_id, leave_type, start_date, end_date, status')
    .eq('id', requestId).maybeSingle();
  if (leaveError || !leave) throw new Error(leaveError?.message ?? 'Leave request not found.');
  const record = leave as LeaveRecord;

  const { data: existing } = await admin.from('leave_sms_notifications').select('status, provider_message_id, attempt_count').eq('leave_request_id', requestId).eq('notification_type', type).maybeSingle();
  if (existing?.status === 'sent') return { sent: true, skipped: true, messageId: existing.provider_message_id as string | null };
  if (existing?.status === 'sending') return { sent: false, skipped: true, messageId: null };

  const [{ data: staff }, { data: store }, { data: details }] = await Promise.all([
    admin.from('staff').select('name').eq('id', record.staff_id).maybeSingle(),
    admin.from('stores').select('name').eq('id', record.store_id).maybeSingle(),
    admin.from('staff_private_details').select('contact_number').eq('staff_id', record.staff_id).maybeSingle(),
  ]);
  const rawRecipient = type === 'submitted_hr' ? (process.env.HR_SMS_NUMBER?.trim() || '+27795144898') : details?.contact_number;
  const recipient = normalizeSouthAfricanMobile(rawRecipient);
  const recipientLastFour = recipient?.slice(-4) ?? null;
  const log = {
    organization_id: record.organization_id,
    store_id: record.store_id,
    leave_request_id: requestId,
    notification_type: type,
    recipient_last_four: recipientLastFour,
    status: 'sending',
    attempt_count: Number(existing?.attempt_count ?? 0) + 1,
    error_message: null,
    completed_at: null,
    updated_at: new Date().toISOString(),
  };
  const { error: logError } = await admin.from('leave_sms_notifications').upsert(log, { onConflict: 'leave_request_id,notification_type' });
  if (logError) throw new Error(logError.message);

  if (!recipient) {
    const message = type === 'submitted_hr' ? 'HR_SMS_NUMBER is missing or invalid.' : 'The staff member has no valid contact number.';
    await admin.from('leave_sms_notifications').update({ status: 'failed', error_message: message, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('leave_request_id', requestId).eq('notification_type', type);
    throw new Error(message);
  }
  const body = type === 'submitted_hr'
    ? buildHrLeaveMessage(String(staff?.name ?? 'A staff member'), String(store?.name ?? 'Unknown branch'), record.leave_type, record.start_date, record.end_date)
    : buildStaffDecisionMessage(record.leave_type, record.start_date, record.end_date, type === 'approved_staff' ? 'approved' : 'rejected');
  try {
    const delivery = await sendSms(recipient, body);
    await admin.from('leave_sms_notifications').update({ status: 'sent', provider_message_id: delivery.messageId, provider_status: delivery.status, error_message: null, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('leave_request_id', requestId).eq('notification_type', type);
    return { sent: true, skipped: false, messageId: delivery.messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SMS delivery failed.';
    await admin.from('leave_sms_notifications').update({ status: 'failed', error_message: message.slice(0, 500), completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('leave_request_id', requestId).eq('notification_type', type);
    throw error;
  }
}
