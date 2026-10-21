import 'server-only';

import {
  calculateAttendanceReport,
  classificationStart,
  resolveReportPeriod,
  sumSummary,
  type AttendanceStatus,
  type ReportFilters,
  type ReportPeriodPreset,
  type ReportingEmployee,
  type ReportingLeave,
  type ReportingRecord,
  type ReportingSchedule,
} from '@/lib/attendance/reporting';
import { timeToMinute } from '@/lib/attendance/calculation';
import type { LeaveType } from '@/lib/leave/types';
import { buildAbsenceAndLeaveRows } from '@/lib/reports/absence-leave';
import type { ReportAuthorization } from '@/lib/reports/authorization';
import { fetchAllPages } from '@/lib/reports/pagination';

const TIMEZONE = 'Africa/Johannesburg';

type ReportRequest = {
  preset: ReportPeriodPreset;
  start?: string;
  end?: string;
  branchIds?: string[];
  employeeId?: string;
  search?: string;
  statuses?: AttendanceStatus[];
  hasNormalHours?: boolean;
  hasOvertime?: boolean;
  missingClockIn?: boolean;
  missingClockOut?: boolean;
  late?: boolean;
  early?: boolean;
  absent?: boolean;
  incomplete?: boolean;
  page?: number;
  pageSize?: number;
};

type AttendanceSourceRow = {
  id: string;
  staff_id: string;
  store_id: string;
  work_date: string;
  clock_in: string | null;
  clock_out: string | null;
  record_source: string;
  adjustment_reason: string | null;
};

function localDate(value: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

function localMinute(value: string | null, workDate: string) {
  if (!value) return null;
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  const dayOffset = Math.round((new Date(`${localDate(value)}T12:00:00Z`).getTime() - new Date(`${workDate}T12:00:00Z`).getTime()) / 86_400_000);
  return dayOffset * 1440 + hour * 60 + minute;
}

export async function buildAttendanceReport(auth: ReportAuthorization, request: ReportRequest, reference = new Date()) {
  const period = resolveReportPeriod(request.preset, reference, request.start, request.end);
  const selectedBranches = request.branchIds?.length ? request.branchIds : auth.allowedBranchIds;
  if (!selectedBranches.length) throw new Error('No authorised branches are assigned to this account.');
  if (selectedBranches.some((id) => !auth.allowedBranchIds.includes(id))) throw new Error('You do not have access to one or more selected branches.');
  const lookback = classificationStart(period.start);
  const admin = auth.admin;
  const [organizationResult, storesResult, staffResult, attendanceResult, scheduleResult, holidayResult, leaveResult] = await Promise.all([
    admin.from('organizations').select('name').eq('id', auth.organizationId).single(),
    admin.from('stores').select('id, name').eq('organization_id', auth.organizationId).in('id', selectedBranches).order('name'),
    admin.from('staff').select('id, store_id, name, active, created_at, archived_at').eq('organization_id', auth.organizationId).in('store_id', selectedBranches).order('name'),
    fetchAllPages<AttendanceSourceRow>((from, to) => admin.from('attendance').select('id, staff_id, store_id, work_date, clock_in, clock_out, record_source, adjustment_reason').eq('organization_id', auth.organizationId).in('store_id', selectedBranches).gte('work_date', lookback).lte('work_date', period.end).order('work_date').order('clock_in').order('id').range(from, to)),
    admin.from('work_schedule').select('day_of_week, opens_at, closes_at, unpaid_break_minutes').eq('organization_id', auth.organizationId),
    admin.from('public_holidays').select('holiday_date, name').gte('holiday_date', lookback).lte('holiday_date', period.end),
    admin.from('leave_requests').select('id, staff_id, store_id, start_date, end_date, leave_type, reason, status').eq('organization_id', auth.organizationId).in('store_id', selectedBranches).lte('start_date', period.end).gte('end_date', lookback),
  ]);
  const firstError = [organizationResult, storesResult, staffResult, attendanceResult, scheduleResult, holidayResult, leaveResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);
  const stores = new Map((storesResult.data ?? []).map((row) => [String(row.id), String(row.name)]));
  const rawAttendance = attendanceResult.data ?? [];
  const rawLeave = leaveResult.data ?? [];
  const employees: ReportingEmployee[] = (staffResult.data ?? []).filter((row) => row.active || rawAttendance.some((record) => record.staff_id === row.id && record.work_date >= period.start) || rawLeave.some((leave) => leave.staff_id === row.id && leave.status === 'approved')).map((row) => ({
    id: String(row.id), name: String(row.name), branchId: String(row.store_id), branchName: stores.get(String(row.store_id)) ?? 'Unknown branch', active: Boolean(row.active), employmentStartDate: localDate(String(row.created_at)), employmentEndDate: row.archived_at ? localDate(String(row.archived_at)) : null,
  }));
  const employeeIds = new Set(employees.map((employee) => employee.id));
  if (request.employeeId && !employeeIds.has(request.employeeId)) throw new Error('The selected employee is not available within your authorised branches.');
  const records: ReportingRecord[] = rawAttendance.filter((row) => employeeIds.has(String(row.staff_id))).map((row) => ({
    id: String(row.id), staffId: String(row.staff_id), branchId: String(row.store_id), date: String(row.work_date), clockInMinute: localMinute(row.clock_in as string | null, String(row.work_date)), clockOutMinute: localMinute(row.clock_out as string | null, String(row.work_date)), source: row.record_source === 'administrator_adjustment' ? 'administrator_adjustment' : 'employee_clocking', adjustmentReason: row.adjustment_reason ? String(row.adjustment_reason) : null,
  }));
  const schedules: ReportingSchedule[] = (scheduleResult.data ?? []).map((row) => ({ dayOfWeek: Number(row.day_of_week), opensAtMinute: timeToMinute(row.opens_at as string | null), closesAtMinute: timeToMinute(row.closes_at as string | null), unpaidBreakMinutes: Number(row.unpaid_break_minutes) }));
  const leave: ReportingLeave[] = rawLeave.map((row) => ({ id: String(row.id), staffId: String(row.staff_id), branchId: String(row.store_id), branchName: stores.get(String(row.store_id)) ?? 'Unknown branch', startDate: String(row.start_date), endDate: String(row.end_date), type: row.leave_type as LeaveType, reason: String(row.reason ?? ''), status: String(row.status) }));
  const filters: ReportFilters = { branchIds: selectedBranches, employeeId: request.employeeId, search: request.search, statuses: request.statuses, hasNormalHours: request.hasNormalHours, hasOvertime: request.hasOvertime, missingClockIn: request.missingClockIn, missingClockOut: request.missingClockOut, late: request.late, early: request.early, absent: request.absent, incomplete: request.incomplete };
  const report = calculateAttendanceReport({ employees, records, schedules, publicHolidayDates: (holidayResult.data ?? []).map((row) => String(row.holiday_date)), leave, reportStart: period.start, reportEnd: period.end, today: period.today, filters });
  const absenceAndLeave = buildAbsenceAndLeaveRows({ dailyRows: report.daily, leave, employees, reportStart: period.start, reportEnd: period.end });
  const branchSubtotals = [...new Set(report.summary.map((row) => row.branchId))].map((branchId) => {
    const rows = report.summary.filter((row) => row.branchId === branchId);
    return { branchId, branchName: rows[0]?.branchName ?? stores.get(branchId) ?? 'Unknown branch', ...sumSummary(rows) };
  });
  const page = Math.max(1, Math.floor(request.page ?? 1));
  const pageSize = Math.min(200, Math.max(10, Math.floor(request.pageSize ?? 50)));
  const offset = (page - 1) * pageSize;
  return {
    organizationName: String(organizationResult.data?.name ?? 'Organisation'),
    timeZone: TIMEZONE,
    role: auth.role,
    period,
    filters,
    options: { branches: [...stores].map(([id, name]) => ({ id, name })), employees: employees.map(({ id, name, branchId }) => ({ id, name, branchId })), departments: [] as string[] },
    daily: report.daily.slice(offset, offset + pageSize),
    dailyTotal: report.daily.length,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(report.daily.length / pageSize)),
    summary: report.summary,
    branchSubtotals,
    companyTotal: sumSummary(report.summary),
    overtime: report.overtime,
    patterns: report.patterns,
    trends: report.trends,
    exceptions: report.daily.filter((row) => row.flags.absent || row.flags.incomplete || row.flags.late || row.flags.early || row.flags.adjusted),
    absenceAndLeave,
    allDailyRows: report.daily,
  };
}

export type AttendanceReport = Awaited<ReturnType<typeof buildAttendanceReport>>;
