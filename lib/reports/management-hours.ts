import 'server-only';

import { calculateConsolidatedMinutes, formatMinutes, managementReportPeriod, type ConsolidatedMinutes } from '@/lib/attendance/consolidated';
import { timeToMinute, type WorkScheduleInput } from '@/lib/attendance/calculation';
import { createAdminClient } from '@/lib/supabase/admin';

export const MANAGEMENT_REPORT_RECIPIENT = 'hr@pits.co.za';
export const MANAGEMENT_REPORT_TYPE = 'weekly_management_mtd_hours';
const TIMEZONE = 'Africa/Johannesburg';

type Store = { id: string; name: string };
type Staff = { id: string; store_id: string; name: string; active: boolean };
type Attendance = { id: string; staff_id: string; work_date: string; clock_in: string; clock_out: string | null };
type Schedule = { day_of_week: number; opens_at: string | null; closes_at: string | null; unpaid_break_minutes: number };
type Holiday = { holiday_date: string };

export type ManagementEmployeeRow = ConsolidatedMinutes & {
  employeeId: string;
  employeeName: string;
};

export type ManagementBranch = {
  branchId: string;
  branchName: string;
  employees: ManagementEmployeeRow[];
  subtotal: ConsolidatedMinutes;
};

export type ManagementHoursReport = {
  organizationName: string;
  reportDate: string;
  periodStart: string;
  periodEnd: string;
  branches: ManagementBranch[];
  companyTotal: ConsolidatedMinutes;
  html: string;
  csv: string;
};

export function reportPeriod(reference = new Date()) {
  return managementReportPeriod(reference, TIMEZONE);
}

function localDate(value: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

function localMinute(value: string, workDate: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(value));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  const dayOffset = Math.round((new Date(`${localDate(value)}T12:00:00Z`).getTime() - new Date(`${workDate}T12:00:00Z`).getTime()) / 86_400_000);
  return dayOffset * 24 * 60 + hour * 60 + minute;
}

function sumMinutes(rows: ConsolidatedMinutes[]): ConsolidatedMinutes {
  return rows.reduce((total, row) => ({
    normalMinutes: total.normalMinutes + row.normalMinutes,
    overtimeOneHalfMinutes: total.overtimeOneHalfMinutes + row.overtimeOneHalfMinutes,
    overtimeDoubleMinutes: total.overtimeDoubleMinutes + row.overtimeDoubleMinutes,
  }), { normalMinutes: 0, overtimeOneHalfMinutes: 0, overtimeDoubleMinutes: 0 });
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'long', year: 'numeric', timeZone: TIMEZONE }).format(new Date(`${value}T12:00:00Z`));
}

function rowValues(label: string, minutes: ConsolidatedMinutes) {
  return [label, formatMinutes(minutes.normalMinutes), formatMinutes(minutes.overtimeOneHalfMinutes), formatMinutes(minutes.overtimeDoubleMinutes), formatMinutes(minutes.overtimeOneHalfMinutes + minutes.overtimeDoubleMinutes)];
}

function renderReport(organizationName: string, reportDate: string, periodStart: string, periodEnd: string, branches: ManagementBranch[], companyTotal: ConsolidatedMinutes) {
  const header = ['Employee name', 'Normal working hours — month to date', 'Overtime hours at 1.5× — month to date', 'Overtime hours at 2× — month to date', 'Total overtime hours — month to date'];
  const csvRows: Array<Array<string>> = [header];
  const htmlBranches = branches.map((branch) => {
    csvRows.push([`BRANCH: ${branch.branchName}`, '', '', '', '']);
    const employeeRows = branch.employees.map((employee) => {
      const values = rowValues(employee.employeeName, employee);
      csvRows.push(values);
      return `<tr><td style="padding:9px;border-bottom:1px solid #e5e7eb">${escapeHtml(values[0])}</td>${values.slice(1).map((value) => `<td style="padding:9px;text-align:right;border-bottom:1px solid #e5e7eb;white-space:nowrap">${escapeHtml(value)}</td>`).join('')}</tr>`;
    }).join('');
    const subtotal = rowValues(`${branch.branchName} subtotal`, branch.subtotal);
    csvRows.push(subtotal, ['', '', '', '', '']);
    return `<tr><th colspan="5" style="padding:10px;text-align:left;background:#eef8f5;color:#087b63">${escapeHtml(branch.branchName)}</th></tr>${employeeRows}<tr style="font-weight:700;background:#f8fafc"><td style="padding:9px">${escapeHtml(subtotal[0])}</td>${subtotal.slice(1).map((value) => `<td style="padding:9px;text-align:right;white-space:nowrap">${escapeHtml(value)}</td>`).join('')}</tr>`;
  }).join('');
  const total = rowValues('Company-wide total', companyTotal);
  csvRows.push(total);
  const csv = csvRows.map((row) => row.map(csvCell).join(',')).join('\n');
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172033;background:#f5f5f2;padding:24px"><div style="max-width:1000px;margin:auto;background:white;padding:28px;border-radius:16px"><div style="color:#087b63;font-weight:700">PRESENTLY · WEEKLY MANAGEMENT HOURS</div><h1 style="margin-bottom:4px">${escapeHtml(organizationName)}</h1><p style="color:#667085">Please find below the consolidated staff working-hours report for the period ${escapeHtml(displayDate(periodStart))} to ${escapeHtml(displayDate(periodEnd))}.</p><table style="width:100%;border-collapse:collapse;margin-top:24px;font-size:13px"><thead><tr style="background:#172033;color:white"><th style="padding:10px;text-align:left">Employee name</th><th style="padding:10px;text-align:right">Normal working hours<br>month to date</th><th style="padding:10px;text-align:right">Overtime at 1.5×<br>month to date</th><th style="padding:10px;text-align:right">Overtime at 2×<br>month to date</th><th style="padding:10px;text-align:right">Total overtime<br>month to date</th></tr></thead><tbody>${htmlBranches || '<tr><td colspan="5" style="padding:12px">No employees found.</td></tr>'}<tr style="font-weight:700;background:#172033;color:white"><td style="padding:10px">${escapeHtml(total[0])}</td>${total.slice(1).map((value) => `<td style="padding:10px;text-align:right;white-space:nowrap">${escapeHtml(value)}</td>`).join('')}</tr></tbody></table><p style="margin-top:22px;color:#667085;font-size:12px">Report date: ${escapeHtml(displayDate(reportDate))}. The attached CSV contains the same consolidated totals and can be opened in Excel.</p></div></body></html>`;
  return { html, csv };
}

export async function buildManagementHoursReport(organizationId: string, period = reportPeriod()): Promise<ManagementHoursReport> {
  const admin = createAdminClient();
  if (!admin) throw new Error('Supabase administration is not configured.');
  const classificationStart = `${period.periodStart.slice(0, 7)}-01`;
  const [orgResult, storesResult, staffResult, attendanceResult, scheduleResult, holidayResult] = await Promise.all([
    admin.from('organizations').select('name').eq('id', organizationId).single(),
    admin.from('stores').select('id, name').eq('organization_id', organizationId).order('name'),
    admin.from('staff').select('id, store_id, name, active').eq('organization_id', organizationId).is('archived_at', null).order('name'),
    admin.from('attendance').select('id, staff_id, work_date, clock_in, clock_out').eq('organization_id', organizationId).gte('work_date', classificationStart).lte('work_date', period.periodEnd).order('work_date').order('clock_in'),
    admin.from('work_schedule').select('day_of_week, opens_at, closes_at, unpaid_break_minutes').eq('organization_id', organizationId),
    admin.from('public_holidays').select('holiday_date').gte('holiday_date', classificationStart).lte('holiday_date', period.periodEnd),
  ]);
  const firstError = [orgResult, storesResult, staffResult, attendanceResult, scheduleResult, holidayResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);
  if (!orgResult.data) throw new Error('Organisation not found.');

  const stores = (storesResult.data ?? []) as Store[];
  const staff = (staffResult.data ?? []) as Staff[];
  const attendance = (attendanceResult.data ?? []) as Attendance[];
  const schedules: WorkScheduleInput[] = ((scheduleResult.data ?? []) as Schedule[]).map((schedule) => ({
    dayOfWeek: schedule.day_of_week,
    opensAtMinute: timeToMinute(schedule.opens_at),
    closesAtMinute: timeToMinute(schedule.closes_at),
    unpaidBreakMinutes: schedule.unpaid_break_minutes,
  }));
  const minutes = calculateConsolidatedMinutes(attendance.map((record) => ({
    id: record.id,
    staffId: record.staff_id,
    date: record.work_date,
    clockInMinute: localMinute(record.clock_in, record.work_date),
    clockOutMinute: record.clock_out ? localMinute(record.clock_out, record.work_date) : null,
  })), schedules, ((holidayResult.data ?? []) as Holiday[]).map((holiday) => holiday.holiday_date), period.periodStart, period.periodEnd);

  const includedStaff = staff.filter((employee) => employee.active || attendance.some((record) => record.staff_id === employee.id && record.work_date >= period.periodStart));
  const branches = stores.map((store) => {
    const employees = includedStaff.filter((employee) => employee.store_id === store.id).map((employee) => ({
      employeeId: employee.id,
      employeeName: employee.name,
      ...(minutes.get(employee.id) ?? { normalMinutes: 0, overtimeOneHalfMinutes: 0, overtimeDoubleMinutes: 0 }),
    }));
    return { branchId: store.id, branchName: store.name, employees, subtotal: sumMinutes(employees) };
  }).filter((branch) => branch.employees.length > 0);
  const companyTotal = sumMinutes(branches.map((branch) => branch.subtotal));
  const rendered = renderReport(String(orgResult.data.name), period.reportDate, period.periodStart, period.periodEnd, branches, companyTotal);
  return { organizationName: String(orgResult.data.name), ...period, branches, companyTotal, ...rendered };
}

export async function sendManagementHoursReport(organizationId: string, trigger: 'scheduled' | 'manual', period = reportPeriod()) {
  const admin = createAdminClient();
  if (!admin) throw new Error('Supabase administration is not configured.');
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.REPORT_FROM_EMAIL?.trim();
  if (!apiKey || !from) throw new Error('Email delivery is not configured.');

  const run = { organization_id: organizationId, report_type: MANAGEMENT_REPORT_TYPE, report_date: period.reportDate, period_start: period.periodStart, period_end: period.periodEnd, generated_at: new Date().toISOString(), recipient_email: MANAGEMENT_REPORT_RECIPIENT, trigger, status: 'sending' };
  const { data: initialClaim, error: claimError } = await admin.from('management_hours_report_runs').insert(run).select('id').maybeSingle();
  let claimed = initialClaim;
  if (claimError?.code === '23505') {
    const { data: existing, error } = await admin.from('management_hours_report_runs').select('id, status').eq('organization_id', organizationId).eq('report_type', MANAGEMENT_REPORT_TYPE).eq('report_date', period.reportDate).eq('recipient_email', MANAGEMENT_REPORT_RECIPIENT).single();
    if (error) throw new Error(error.message);
    if (existing.status !== 'failed') return { skipped: true, status: existing.status as string };
    const retry = await admin.from('management_hours_report_runs').update({ status: 'sending', error_message: null, generated_at: new Date().toISOString(), trigger }).eq('id', existing.id).eq('status', 'failed').select('id').maybeSingle();
    if (retry.error) throw new Error(retry.error.message);
    claimed = retry.data;
    if (!claimed) return { skipped: true, status: 'sending' };
  } else if (claimError) throw new Error(claimError.message);
  if (!claimed) return { skipped: true, status: 'sending' };

  try {
    const report = await buildManagementHoursReport(organizationId, period);
    const subject = `Weekly Staff Hours Report – Month to Date – ${displayDate(period.reportDate)}`;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `${MANAGEMENT_REPORT_TYPE}-${organizationId}-${period.reportDate}` },
      body: JSON.stringify({ from, to: [MANAGEMENT_REPORT_RECIPIENT], subject, html: report.html, attachments: [{ filename: `weekly-staff-hours-${period.reportDate}.csv`, content: Buffer.from(`\ufeff${report.csv}`).toString('base64') }] }),
    });
    const payload = await response.json().catch(() => ({})) as { id?: string; message?: string };
    if (!response.ok) throw new Error(payload.message || `Email provider returned ${response.status}.`);
    const { error } = await admin.from('management_hours_report_runs').update({ status: 'sent', provider_message_id: payload.id ?? null, completed_at: new Date().toISOString() }).eq('id', claimed.id);
    if (error) throw new Error(error.message);
    return { skipped: false, status: 'sent', messageId: payload.id ?? null, report };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Report delivery failed.';
    await admin.from('management_hours_report_runs').update({ status: 'failed', error_message: message.slice(0, 1000), completed_at: new Date().toISOString() }).eq('id', claimed.id);
    throw error;
  }
}

export async function processScheduledManagementReports(period = reportPeriod()) {
  const admin = createAdminClient();
  if (!admin) throw new Error('Supabase administration is not configured.');
  const { data: settings, error } = await admin.from('weekly_report_settings').select('organization_id').eq('enabled', true);
  if (error) throw new Error(error.message);
  const results = [];
  for (const setting of settings ?? []) {
    try {
      const result = await sendManagementHoursReport(String(setting.organization_id), 'scheduled', period);
      results.push({ organizationId: setting.organization_id, ok: true, skipped: result.skipped, status: result.status });
    } catch (sendError) {
      results.push({ organizationId: setting.organization_id, ok: false, error: sendError instanceof Error ? sendError.message : 'Report failed.' });
    }
  }
  return { ...period, recipient: MANAGEMENT_REPORT_RECIPIENT, processed: results.length, failures: results.filter((result) => !result.ok).length, results };
}
