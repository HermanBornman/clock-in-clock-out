import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

type Store = { id: string; name: string; location: string; code: string };
type Staff = { id: string; store_id: string; name: string; role: string; active: boolean };
type Attendance = { id: string; staff_id: string; store_id: string; work_date: string; clock_in: string; clock_out: string | null };
type Leave = { staff_id: string; store_id: string; leave_type: 'annual' | 'sick'; start_date: string; end_date: string; status: string };
type Schedule = { day_of_week: number; opens_at: string | null; closes_at: string | null; unpaid_break_minutes: number };
type Holiday = { holiday_date: string; name: string };
type Detail = { storeId: string; store: string; employee: string; role: string; date: string; clockIn: string; clockOut: string; worked: number; ordinary: number; overtime: number; publicHoliday: number; lateMinutes: number; result: string };

const TIMEZONE = 'Africa/Johannesburg';

function isoDate(date: Date) { return date.toISOString().slice(0, 10); }
function addDays(value: string, days: number) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return isoDate(date); }
function enumerateDates(start: string, end: string) { const dates: string[] = []; for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date); return dates; }
function isoDay(date: string) { const day = new Date(`${date}T12:00:00Z`).getUTCDay(); return day === 0 ? 7 : day; }
function round(value: number) { return Math.round(value * 10) / 10; }
function escapeHtml(value: unknown) { return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character); }
function csvCell(value: unknown) { const text = String(value ?? ''); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function localTimeParts(value: string) { const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(value)); return { hour: Number(parts.find((part) => part.type === 'hour')?.value ?? 0), minute: Number(parts.find((part) => part.type === 'minute')?.value ?? 0) }; }
function displayTime(value: string | null) { return value ? new Intl.DateTimeFormat('en-ZA', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '—'; }

export function previousWeek(reference = new Date()) {
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(reference);
  const currentIsoDay = isoDay(localDate);
  const thisMonday = addDays(localDate, 1 - currentIsoDay);
  return { weekStart: addDays(thisMonday, -7), weekEnd: addDays(thisMonday, -1) };
}

function leaveTypeFor(staffId: string, date: string, leaves: Leave[]) {
  return leaves.find((leave) => leave.staff_id === staffId && leave.status === 'approved' && leave.start_date <= date && leave.end_date >= date)?.leave_type;
}

export async function buildWeeklyReport(organizationId: string, weekStart: string, weekEnd: string) {
  const admin = createAdminClient();
  if (!admin) throw new Error('Supabase administration is not configured.');
  const [orgResult, storesResult, staffResult, attendanceResult, leaveResult, scheduleResult, holidaysResult] = await Promise.all([
    admin.from('organizations').select('name').eq('id', organizationId).single(),
    admin.from('stores').select('id, name, location, code').eq('organization_id', organizationId).order('name'),
    admin.from('staff').select('id, store_id, name, role, active').eq('organization_id', organizationId).order('name'),
    admin.from('attendance').select('id, staff_id, store_id, work_date, clock_in, clock_out').eq('organization_id', organizationId).gte('work_date', weekStart).lte('work_date', weekEnd).order('work_date').order('clock_in'),
    admin.from('leave_requests').select('staff_id, store_id, leave_type, start_date, end_date, status').eq('organization_id', organizationId).lte('start_date', weekEnd).gte('end_date', weekStart),
    admin.from('work_schedule').select('day_of_week, opens_at, closes_at, unpaid_break_minutes').eq('organization_id', organizationId),
    admin.from('public_holidays').select('holiday_date, name').gte('holiday_date', weekStart).lte('holiday_date', weekEnd),
  ]);
  const firstError = [orgResult, storesResult, staffResult, attendanceResult, leaveResult, scheduleResult, holidaysResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);
  if (!orgResult.data) throw new Error('Organisation not found.');

  const organizationName = orgResult.data.name as string;
  const stores = (storesResult.data ?? []) as Store[];
  const staff = (staffResult.data ?? []) as Staff[];
  const attendance = (attendanceResult.data ?? []) as Attendance[];
  const leaves = (leaveResult.data ?? []) as Leave[];
  const schedules = (scheduleResult.data ?? []) as Schedule[];
  const holidays = (holidaysResult.data ?? []) as Holiday[];
  const holidayDates = new Set(holidays.map((holiday) => holiday.holiday_date));
  const ordinaryUsed = new Map<string, number>();
  const details: Detail[] = [];

  for (const record of attendance) {
    const employee = staff.find((item) => item.id === record.staff_id);
    const store = stores.find((item) => item.id === record.store_id);
    const schedule = schedules.find((item) => item.day_of_week === isoDay(record.work_date));
    const gross = record.clock_out ? Math.max(0, (new Date(record.clock_out).getTime() - new Date(record.clock_in).getTime()) / 3_600_000) : 0;
    const worked = record.clock_out ? round(Math.max(0, gross - ((schedule?.unpaid_break_minutes ?? 0) / 60))) : 0;
    const holiday = holidayDates.has(record.work_date);
    const used = ordinaryUsed.get(record.staff_id) ?? 0;
    const ordinary = holiday ? 0 : round(Math.min(worked, Math.max(0, 45 - used)));
    const overtime = holiday ? 0 : round(Math.max(0, worked - ordinary));
    ordinaryUsed.set(record.staff_id, used + ordinary);
    const local = localTimeParts(record.clock_in);
    const [openHour, openMinute] = (schedule?.opens_at ?? '00:00').split(':').map(Number);
    const lateMinutes = schedule?.opens_at ? Math.max(0, local.hour * 60 + local.minute - (openHour * 60 + openMinute)) : 0;
    details.push({ storeId: record.store_id, store: store?.name ?? 'Unknown store', employee: employee?.name ?? 'Unknown staff', role: employee?.role ?? '', date: record.work_date, clockIn: displayTime(record.clock_in), clockOut: displayTime(record.clock_out), worked, ordinary, overtime, publicHoliday: holiday ? worked : 0, lateMinutes, result: record.clock_out ? (lateMinutes ? 'Late' : 'Complete') : 'Missing clock-out' });
  }

  const dates = enumerateDates(weekStart, weekEnd);
  for (const employee of staff.filter((item) => item.active)) {
    const store = stores.find((item) => item.id === employee.store_id);
    for (const date of dates) {
      const schedule = schedules.find((item) => item.day_of_week === isoDay(date));
      if (!schedule?.opens_at || holidayDates.has(date) || attendance.some((item) => item.staff_id === employee.id && item.work_date === date)) continue;
      const leaveType = leaveTypeFor(employee.id, date, leaves);
      details.push({ storeId: employee.store_id, store: store?.name ?? 'Unknown store', employee: employee.name, role: employee.role, date, clockIn: '—', clockOut: '—', worked: 0, ordinary: 0, overtime: 0, publicHoliday: 0, lateMinutes: 0, result: leaveType === 'annual' ? 'Annual leave' : leaveType === 'sick' ? 'Sick leave' : 'Absent' });
    }
  }

  details.sort((a, b) => `${a.store}${a.employee}${a.date}`.localeCompare(`${b.store}${b.employee}${b.date}`));
  const summaries = stores.map((store) => {
    const rows = details.filter((row) => row.storeId === store.id);
    const shiftRows = rows.filter((row) => row.clockIn !== '—');
    return { store, staff: staff.filter((item) => item.store_id === store.id && item.active).length, shifts: shiftRows.length, worked: round(shiftRows.reduce((sum, row) => sum + row.worked, 0)), ordinary: round(shiftRows.reduce((sum, row) => sum + row.ordinary, 0)), overtime: round(shiftRows.reduce((sum, row) => sum + row.overtime, 0)), holiday: round(shiftRows.reduce((sum, row) => sum + row.publicHoliday, 0)), late: shiftRows.filter((row) => row.lateMinutes > 0).length, missingClockOut: shiftRows.filter((row) => row.result === 'Missing clock-out').length, absent: rows.filter((row) => row.result === 'Absent').length, annualLeave: rows.filter((row) => row.result === 'Annual leave').length, sickLeave: rows.filter((row) => row.result === 'Sick leave').length };
  });
  const totals = summaries.reduce((total, row) => ({ staff: total.staff + row.staff, shifts: total.shifts + row.shifts, worked: round(total.worked + row.worked), ordinary: round(total.ordinary + row.ordinary), overtime: round(total.overtime + row.overtime), holiday: round(total.holiday + row.holiday), late: total.late + row.late, missingClockOut: total.missingClockOut + row.missingClockOut, absent: total.absent + row.absent, annualLeave: total.annualLeave + row.annualLeave, sickLeave: total.sickLeave + row.sickLeave }), { staff: 0, shifts: 0, worked: 0, ordinary: 0, overtime: 0, holiday: 0, late: 0, missingClockOut: 0, absent: 0, annualLeave: 0, sickLeave: 0 });
  const header = ['Branch', 'Employee', 'Role', 'Date', 'Clock in', 'Clock out', 'Worked hours', 'Ordinary hours', 'Overtime hours', 'Public holiday hours', 'Late minutes', 'Result'];
  const csv = [header, ...details.map((row) => [row.store, row.employee, row.role, row.date, row.clockIn, row.clockOut, row.worked.toFixed(1), row.ordinary.toFixed(1), row.overtime.toFixed(1), row.publicHoliday.toFixed(1), row.lateMinutes, row.result])].map((row) => row.map(csvCell).join(',')).join('\n');
  const summaryRows = summaries.map((row) => `<tr><td><strong>${escapeHtml(row.store.name)}</strong><br><small>${escapeHtml(row.store.location)}</small></td><td>${row.staff}</td><td>${row.shifts}</td><td>${row.worked.toFixed(1)}</td><td>${row.overtime.toFixed(1)}</td><td>${row.late}</td><td>${row.absent}</td><td>${row.annualLeave}</td><td>${row.sickLeave}</td><td>${row.missingClockOut}</td></tr>`).join('');
  const exceptions = details.filter((row) => row.result !== 'Complete').slice(0, 50).map((row) => `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.store)}</td><td>${escapeHtml(row.employee)}</td><td>${escapeHtml(row.result)}</td><td>${row.lateMinutes || '—'}</td></tr>`).join('');
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172033;background:#f5f5f2;padding:24px"><div style="max-width:1000px;margin:auto;background:white;padding:28px;border-radius:16px"><div style="color:#087b63;font-weight:700">PRESENTLY · WEEKLY HR REPORT</div><h1 style="margin-bottom:4px">${escapeHtml(organizationName)}</h1><p style="color:#667085">${escapeHtml(weekStart)} to ${escapeHtml(weekEnd)} · All branches</p><table style="width:100%;border-collapse:collapse;margin:24px 0"><tr style="background:#eef8f5"><td style="padding:14px"><b>${totals.staff}</b><br><small>Active staff</small></td><td style="padding:14px"><b>${totals.worked.toFixed(1)}</b><br><small>Hours worked</small></td><td style="padding:14px"><b>${totals.overtime.toFixed(1)}</b><br><small>Overtime hours</small></td><td style="padding:14px"><b>${totals.absent}</b><br><small>Absent days</small></td><td style="padding:14px"><b>${totals.late}</b><br><small>Late arrivals</small></td></tr></table><h2>Branch summary</h2><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left;background:#172033;color:white"><th style="padding:9px">Branch</th><th>Staff</th><th>Shifts</th><th>Worked</th><th>OT</th><th>Late</th><th>Absent</th><th>Annual</th><th>Sick</th><th>Missing out</th></tr></thead><tbody>${summaryRows || '<tr><td colspan="10">No branches found.</td></tr>'}</tbody></table><h2 style="margin-top:28px">Exceptions and leave</h2><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left;background:#f0f2f5"><th style="padding:9px">Date</th><th>Branch</th><th>Employee</th><th>Result</th><th>Late min</th></tr></thead><tbody>${exceptions || '<tr><td colspan="5" style="padding:10px">No exceptions recorded.</td></tr>'}</tbody></table><p style="margin-top:28px;color:#667085;font-size:12px">The attached CSV contains every shift, absence and approved leave day. Hours are attendance classifications for HR review and are not payroll calculations.</p></div></body></html>`;
  return { organizationName, weekStart, weekEnd, totals, summaries, details, csv, html };
}

export async function sendWeeklyReport(organizationId: string, recipient: string, weekStart: string, weekEnd: string, force = false) {
  const admin = createAdminClient();
  if (!admin) throw new Error('Supabase administration is not configured.');
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error('Email delivery is not configured. Add RESEND_API_KEY in Vercel.');
  const report = await buildWeeklyReport(organizationId, weekStart, weekEnd);
  const run = { organization_id: organizationId, week_start: weekStart, week_end: weekEnd, recipient_email: recipient, status: 'sending' };
  if (!force) {
    const { data: existing } = await admin.from('weekly_report_runs').select('status').eq('organization_id', organizationId).eq('week_start', weekStart).eq('recipient_email', recipient).maybeSingle();
    if (existing?.status === 'sent') return { skipped: true, report };
  }
  await admin.from('weekly_report_runs').upsert(run, { onConflict: 'organization_id,week_start,recipient_email' });
  const from = process.env.REPORT_FROM_EMAIL?.trim() || 'Presently Reports <onboarding@resend.dev>';
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent': 'Presently-Attendance/1.0', 'Idempotency-Key': `weekly-${organizationId}-${weekStart}-${force ? Date.now() : 'scheduled'}` }, body: JSON.stringify({ from, to: [recipient], subject: `${report.organizationName} weekly attendance · ${weekStart} to ${weekEnd}`, html: report.html, attachments: [{ filename: `attendance-${weekStart}-to-${weekEnd}.csv`, content: Buffer.from(`\uFEFF${report.csv}`, 'utf8').toString('base64') }] }) });
  const payload = await response.json().catch(() => ({})) as { id?: string; message?: string; error?: { message?: string } };
  if (!response.ok) {
    const message = payload.message ?? payload.error?.message ?? `Email provider returned ${response.status}.`;
    await admin.from('weekly_report_runs').update({ status: 'failed', error_message: message, completed_at: new Date().toISOString() }).eq('organization_id', organizationId).eq('week_start', weekStart).eq('recipient_email', recipient);
    throw new Error(message);
  }
  await admin.from('weekly_report_runs').update({ status: 'sent', provider_message_id: payload.id ?? null, error_message: null, completed_at: new Date().toISOString() }).eq('organization_id', organizationId).eq('week_start', weekStart).eq('recipient_email', recipient);
  return { skipped: false, report, messageId: payload.id };
}
