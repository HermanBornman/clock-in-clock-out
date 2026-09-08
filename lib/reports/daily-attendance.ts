import 'server-only';
import { classifyDailyStatus } from '@/lib/attendance/daily-status';
import { createAdminClient } from '@/lib/supabase/admin';

const TIMEZONE = 'Africa/Johannesburg';
const DEFAULT_RECIPIENT = 'hr@pits.co.za';

type Organization = { id: string; name: string };
type Store = { id: string; organization_id: string; name: string; location: string; active: boolean };
type Staff = { id: string; organization_id: string; store_id: string; name: string; role: string; active: boolean };
type Attendance = { staff_id: string; clock_in: string };
type Leave = { staff_id: string };

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
}

function johannesburgDate(reference: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(reference);
}

function localMinute(value: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(value));
  return Number(parts.find((part) => part.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
}

function isoDay(date: string) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export async function sendDailyAttendanceAlert(reference = new Date()) {
  const admin = createAdminClient();
  if (!admin) throw new Error('Supabase administration is not configured.');
  const reportDate = johannesburgDate(reference);
  if (isoDay(reportDate) > 5) return { skipped: true, reason: 'weekend', reportDate };

  const { data: holiday, error: holidayError } = await admin.from('public_holidays').select('name').eq('holiday_date', reportDate).maybeSingle();
  if (holidayError) throw new Error(holidayError.message);
  if (holiday) return { skipped: true, reason: 'public-holiday', reportDate };

  const recipient = process.env.HR_ATTENDANCE_EMAIL?.trim().toLowerCase() || DEFAULT_RECIPIENT;
  const { data: existing, error: auditReadError } = await admin.from('daily_attendance_alert_runs').select('status').eq('report_date', reportDate).eq('recipient_email', recipient).maybeSingle();
  const auditAvailable = !auditReadError;
  if (existing?.status === 'sent') return { skipped: true, reason: 'already-sent', reportDate };

  const [organizationsResult, storesResult, staffResult, attendanceResult, leaveResult] = await Promise.all([
    admin.from('organizations').select('id, name').order('name'),
    admin.from('stores').select('id, organization_id, name, location, active').eq('active', true).order('name'),
    admin.from('staff').select('id, organization_id, store_id, name, role, active').eq('active', true).is('archived_at', null).order('name'),
    admin.from('attendance').select('staff_id, clock_in').eq('work_date', reportDate).order('clock_in'),
    admin.from('leave_requests').select('staff_id').eq('status', 'approved').lte('start_date', reportDate).gte('end_date', reportDate),
  ]);
  const firstError = [organizationsResult, storesResult, staffResult, attendanceResult, leaveResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  const organizations = (organizationsResult.data ?? []) as Organization[];
  const stores = (storesResult.data ?? []) as Store[];
  const activeStoreIds = new Set(stores.map((store) => store.id));
  const staff = ((staffResult.data ?? []) as Staff[]).filter((person) => activeStoreIds.has(person.store_id));
  const attendance = (attendanceResult.data ?? []) as Attendance[];
  const leaves = (leaveResult.data ?? []) as Leave[];
  const status = classifyDailyStatus(staff, attendance.map((entry) => ({ staffId: entry.staff_id, clockInMinute: localMinute(entry.clock_in) })), leaves.map((leave) => leave.staff_id));

  const personRow = (person: Staff, label: 'Late' | 'Absent / not clocked in') => {
    const store = stores.find((item) => item.id === person.store_id);
    const organization = organizations.find((item) => item.id === person.organization_id);
    const clockIn = attendance.filter((entry) => entry.staff_id === person.id).sort((a, b) => a.clock_in.localeCompare(b.clock_in))[0];
    const time = clockIn ? new Intl.DateTimeFormat('en-ZA', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(clockIn.clock_in)) : '—';
    return `<tr><td style="padding:9px;border-bottom:1px solid #e5e7eb">${escapeHtml(person.name)}</td><td style="padding:9px;border-bottom:1px solid #e5e7eb">${escapeHtml(person.role)}</td><td style="padding:9px;border-bottom:1px solid #e5e7eb">${escapeHtml(store?.name ?? 'Unknown branch')}</td><td style="padding:9px;border-bottom:1px solid #e5e7eb">${escapeHtml(organization?.name ?? '')}</td><td style="padding:9px;border-bottom:1px solid #e5e7eb"><strong>${label}</strong></td><td style="padding:9px;border-bottom:1px solid #e5e7eb">${time}</td></tr>`;
  };
  const rows = [
    ...status.late.map((person) => personRow(person as Staff, 'Late')),
    ...status.absent.map((person) => personRow(person as Staff, 'Absent / not clocked in')),
  ].join('');
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172033;background:#f5f5f2;padding:24px"><div style="max-width:900px;margin:auto;background:white;padding:28px;border-radius:16px"><div style="color:#087b63;font-weight:700">PRESENTLY · 08:00 ATTENDANCE CHECK</div><h1 style="margin-bottom:4px">Daily staff exceptions</h1><p style="color:#667085">${escapeHtml(reportDate)} · Africa/Johannesburg</p><p><strong>${status.late.length}</strong> late · <strong>${status.absent.length}</strong> absent/not clocked in</p><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left;background:#172033;color:white"><th style="padding:9px">Employee</th><th>Role</th><th>Branch</th><th>Organisation</th><th>Status</th><th>Clock in</th></tr></thead><tbody>${rows || '<tr><td colspan="6" style="padding:12px">All active staff are accounted for.</td></tr>'}</tbody></table><p style="margin-top:24px;color:#667085;font-size:12px">Approved leave is excluded. This is the single daily attendance notification.</p></div></body></html>`;

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error('Email delivery is not configured. Add RESEND_API_KEY in Vercel.');
  const run = { report_date: reportDate, recipient_email: recipient, status: 'sending', late_count: status.late.length, absent_count: status.absent.length, error_message: null, completed_at: null };
  if (auditAvailable) {
    const { error: runError } = await admin.from('daily_attendance_alert_runs').upsert(run, { onConflict: 'report_date,recipient_email' });
    if (runError) throw new Error(runError.message);
  }

  const from = process.env.REPORT_FROM_EMAIL?.trim() || 'Presently Reports <onboarding@resend.dev>';
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent': 'Presently-Attendance/1.0', 'Idempotency-Key': `daily-attendance-${reportDate}-${recipient}` },
    body: JSON.stringify({ from, to: [recipient], subject: `08:00 attendance exceptions · ${reportDate}`, html }),
  });
  const payload = await response.json().catch(() => ({})) as { id?: string; message?: string; error?: { message?: string } };
  if (!response.ok) {
    const message = payload.message ?? payload.error?.message ?? `Email provider returned ${response.status}.`;
    if (auditAvailable) await admin.from('daily_attendance_alert_runs').update({ status: 'failed', error_message: message, completed_at: new Date().toISOString() }).eq('report_date', reportDate).eq('recipient_email', recipient);
    throw new Error(message);
  }
  if (auditAvailable) await admin.from('daily_attendance_alert_runs').update({ status: 'sent', provider_message_id: payload.id ?? null, error_message: null, completed_at: new Date().toISOString() }).eq('report_date', reportDate).eq('recipient_email', recipient);
  return { skipped: false, reportDate, late: status.late.length, absent: status.absent.length, messageId: payload.id };
}
