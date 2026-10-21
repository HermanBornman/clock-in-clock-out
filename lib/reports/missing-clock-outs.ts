import 'server-only';
import { sendEmail } from '@/lib/notifications/email';
import { buildMissingClockOutEmail, previousJohannesburgDate, type MissingClockOutRow } from '@/lib/reports/missing-clock-out-content';
import { createAdminClient } from '@/lib/supabase/admin';

const TIMEZONE = 'Africa/Johannesburg';
export const MISSING_CLOCK_OUT_RECIPIENT = 'chelmain@pitspaints.co.za';

type OpenAttendance = {
  organization_id: string;
  staff_id: string;
  store_id: string;
  work_date: string;
  clock_in: string;
};

function displayTime(value: string) {
  return new Intl.DateTimeFormat('en-ZA', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

export async function sendMissingClockOutReport(reference = new Date()) {
  const admin = createAdminClient();
  if (!admin) throw new Error('Supabase administration is not configured.');
  const reportDate = previousJohannesburgDate(reference);
  const recipient = MISSING_CLOCK_OUT_RECIPIENT;

  const { data: openRows, error: attendanceError } = await admin.from('attendance')
    .select('organization_id, staff_id, store_id, work_date, clock_in')
    .eq('work_date', reportDate)
    .is('clock_out', null)
    .order('clock_in');
  if (attendanceError) throw new Error(attendanceError.message);
  const open = (openRows ?? []) as OpenAttendance[];
  if (!open.length) return { skipped: true, reason: 'no-missing-clock-outs', reportDate, count: 0 };

  const { data: existing, error: existingError } = await admin.from('daily_missing_clock_out_runs')
    .select('id, status')
    .eq('report_date', reportDate)
    .eq('recipient_email', recipient)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing?.status === 'sent' || existing?.status === 'sending') return { skipped: true, reason: `already-${existing.status}`, reportDate, count: open.length };

  const staffIds = [...new Set(open.map((row) => row.staff_id))];
  const storeIds = [...new Set(open.map((row) => row.store_id))];
  const organizationIds = [...new Set(open.map((row) => row.organization_id))];
  const [staffResult, storesResult, organizationsResult] = await Promise.all([
    admin.from('staff').select('id, name').in('id', staffIds),
    admin.from('stores').select('id, name').in('id', storeIds),
    admin.from('organizations').select('id, name').in('id', organizationIds),
  ]);
  const firstError = [staffResult, storesResult, organizationsResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);
  const staff = new Map((staffResult.data ?? []).map((row) => [String(row.id), String(row.name)]));
  const stores = new Map((storesResult.data ?? []).map((row) => [String(row.id), String(row.name)]));
  const organizations = new Map((organizationsResult.data ?? []).map((row) => [String(row.id), String(row.name)]));
  const rows: MissingClockOutRow[] = open.map((row) => ({
    employeeName: staff.get(row.staff_id) ?? 'Unknown staff member',
    branchName: stores.get(row.store_id) ?? 'Unknown branch',
    organizationName: organizations.get(row.organization_id) ?? 'Unknown organisation',
    workDate: row.work_date,
    clockIn: displayTime(row.clock_in),
  }));

  let runId = existing?.id ? String(existing.id) : '';
  if (runId) {
    const { data, error } = await admin.from('daily_missing_clock_out_runs')
      .update({ status: 'sending', missing_count: rows.length, error_message: null, completed_at: null })
      .eq('id', runId)
      .eq('status', 'failed')
      .select('id')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { skipped: true, reason: 'already-sending', reportDate, count: rows.length };
  } else {
    const { data, error } = await admin.from('daily_missing_clock_out_runs')
      .insert({ report_date: reportDate, recipient_email: recipient, status: 'sending', missing_count: rows.length })
      .select('id')
      .maybeSingle();
    if (error?.code === '23505') return { skipped: true, reason: 'already-claimed', reportDate, count: rows.length };
    if (error || !data) throw new Error(error?.message ?? 'The missing clock-out report could not be claimed.');
    runId = String(data.id);
  }

  try {
    const content = buildMissingClockOutEmail(reportDate, rows);
    const delivery = await sendEmail({ to: recipient, ...content, idempotencyKey: `missing-clock-outs-${reportDate}-${recipient}` });
    const { error } = await admin.from('daily_missing_clock_out_runs').update({ status: 'sent', provider_message_id: delivery.messageId, error_message: null, completed_at: new Date().toISOString() }).eq('id', runId);
    if (error) throw new Error(error.message);
    return { skipped: false, reportDate, count: rows.length, messageId: delivery.messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Missing clock-out report failed.';
    await admin.from('daily_missing_clock_out_runs').update({ status: 'failed', error_message: message.slice(0, 1000), completed_at: new Date().toISOString() }).eq('id', runId);
    throw error;
  }
}
