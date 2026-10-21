import type { LeaveType } from '@/lib/leave/types';

export type ReportingSchedule = {
  dayOfWeek: number;
  opensAtMinute: number | null;
  closesAtMinute: number | null;
  unpaidBreakMinutes: number;
};

export type ReportingEmployee = {
  id: string;
  name: string;
  branchId: string;
  branchName: string;
  department?: string | null;
  active: boolean;
  employmentStartDate?: string;
  employmentEndDate?: string | null;
};

export type ReportingRecord = {
  id: string;
  staffId: string;
  branchId: string;
  date: string;
  clockInMinute: number | null;
  clockOutMinute: number | null;
  source?: 'employee_clocking' | 'administrator_adjustment';
  adjustmentReason?: string | null;
};

export type ReportingLeave = {
  id: string;
  staffId: string;
  branchId: string;
  branchName: string;
  startDate: string;
  endDate: string;
  type: LeaveType;
  reason: string;
  status: string;
};

export type ReportPeriodPreset = 'today' | 'yesterday' | 'current_week' | 'previous_week' | 'current_month' | 'payroll_period' | 'previous_month' | 'custom';

export type AttendanceStatus =
  | 'Complete'
  | 'Late'
  | 'Early departure'
  | 'Late and early departure'
  | 'Missing clock-in'
  | 'Missing clock-out'
  | 'Incomplete'
  | 'Absent'
  | 'Annual leave'
  | 'Sick leave'
  | 'Family responsibility leave'
  | 'Public holiday'
  | 'Not scheduled'
  | 'Not clocked in';

export type DailyAttendanceRow = {
  id: string;
  attendanceRecordId: string | null;
  attendanceRecords: Array<{ id: string; clockInMinute: number | null; clockOutMinute: number | null; source: string; notes: string }>;
  employeeId: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  department: string | null;
  date: string;
  dayOfWeek: string;
  scheduledStartMinute: number | null;
  actualClockInMinute: number | null;
  scheduledFinishMinute: number | null;
  actualClockOutMinute: number | null;
  recordedBreakMinutes: number;
  automaticBreakMinutes: number;
  normalMinutes: number;
  overtimeOneHalfMinutes: number;
  overtimeDoubleMinutes: number;
  totalOvertimeMinutes: number;
  totalWorkedMinutes: number;
  lateMinutes: number;
  earlyDepartureMinutes: number;
  status: AttendanceStatus;
  source: 'employee_clocking' | 'administrator_adjustment' | 'system';
  notes: string;
  scheduledMinutes: number;
  scheduledDay: boolean;
  qualifyingOvertimeMinutes: number;
  overtimeReason: string | null;
  overtimeApprovalStatus: string | null;
  flags: {
    late: boolean;
    early: boolean;
    missingClockIn: boolean;
    missingClockOut: boolean;
    absent: boolean;
    incomplete: boolean;
    adjusted: boolean;
    overtime: boolean;
  };
};

export type SummaryRow = {
  employeeId: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  daysLoggedInCount: number;
  normalMinutes: number;
  overtimeOneHalfMinutes: number;
  overtimeDoubleMinutes: number;
  totalOvertimeMinutes: number;
  totalWorkedMinutes: number;
  lateArrivalCount: number;
  absenceCount: number;
  incompleteRecordCount: number;
};

export type PatternRow = SummaryRow & {
  totalDaysScheduled: number;
  totalDaysWorked: number;
  totalLateMinutes: number;
  averageClockInMinute: number | null;
  earlyDepartureCount: number;
  totalEarlyDepartureMinutes: number;
  missingClockInCount: number;
  missingClockOutCount: number;
  averageDailyMinutes: number;
  manualAdjustmentCount: number;
  mostCommonClockInMinute: number | null;
  mostCommonClockOutMinute: number | null;
};

export type OvertimeDetailRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  date: string;
  dayOfWeek: string;
  scheduledMinutes: number;
  actualMinutes: number;
  breakDeductionMinutes: number;
  qualifyingOvertimeMinutes: number;
  rate: '1.5×' | '2×';
  reason: string;
  source: 'Automatically calculated' | 'Manually adjusted';
  approvalStatus: string;
};

export type WeeklyTrend = {
  weekStart: string;
  normalMinutes: number;
  overtimeMinutes: number;
  lateArrivals: number;
  absences: number;
  incompleteRecords: number;
};

export type ReportFilters = {
  branchIds?: string[];
  employeeId?: string;
  search?: string;
  department?: string;
  statuses?: AttendanceStatus[];
  hasNormalHours?: boolean;
  hasOvertime?: boolean;
  missingClockIn?: boolean;
  missingClockOut?: boolean;
  late?: boolean;
  early?: boolean;
  absent?: boolean;
  incomplete?: boolean;
};

type DayAllocation = DailyAttendanceRow & { overtimeCandidateMinutes: number; doubleTime: boolean };
type Interval = { start: number; end: number };

const TIMEZONE = 'Africa/Johannesburg';
const WEEKDAY_GRACE_MINUTES = 30;
const ORDINARY_SATURDAYS_PER_MONTH = 2;
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isoDay(value: string) {
  const day = new Date(`${value}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function weekStart(value: string) {
  return addDays(value, 1 - isoDay(value));
}

export function localIsoDate(reference = new Date(), timeZone = TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(reference);
}

function monthStart(value: string) {
  return `${value.slice(0, 7)}-01`;
}

function monthEnd(value: string) {
  const date = new Date(`${monthStart(value)}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

function previousMonth(value: string) {
  const date = new Date(`${monthStart(value)}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

export function resolveReportPeriod(preset: ReportPeriodPreset, reference = new Date(), customStart?: string, customEnd?: string) {
  const today = localIsoDate(reference);
  const yesterday = addDays(today, -1);
  const currentMonday = weekStart(today);
  let start: string;
  let end: string;
  switch (preset) {
    case 'today': start = today; end = today; break;
    case 'yesterday': start = yesterday; end = yesterday; break;
    case 'current_week': start = currentMonday; end = yesterday; break;
    case 'previous_week': start = addDays(currentMonday, -7); end = addDays(currentMonday, -1); break;
    case 'current_month': start = monthStart(today); end = yesterday; break;
    case 'payroll_period': start = `${previousMonth(today)}-25`; end = yesterday; break;
    case 'previous_month': {
      const previous = `${previousMonth(today)}-01`;
      start = previous;
      end = monthEnd(previous);
      break;
    }
    case 'custom':
      if (!customStart || !customEnd) throw new Error('Select a custom start and end date.');
      start = customStart;
      end = customEnd >= today ? yesterday : customEnd;
      break;
    default: throw new Error('Unsupported reporting period.');
  }
  if (start > end && preset !== 'today') throw new Error('This reporting period has no completed days yet.');
  const days = Math.floor((new Date(`${end}T12:00:00Z`).getTime() - new Date(`${start}T12:00:00Z`).getTime()) / 86_400_000) + 1;
  if (days < 1 || days > 366) throw new Error('Reporting periods must contain between 1 and 366 days.');
  return { preset, start, end, today, includesToday: preset === 'today' };
}

export function classificationStart(reportStart: string) {
  return monthStart(weekStart(reportStart));
}

function enumerateDates(start: string, end: string) {
  const values: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) values.push(date);
  return values;
}

function mergeIntervals(intervals: Interval[]) {
  const sorted = intervals.filter((item) => item.end > item.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval.start > previous.end) merged.push({ ...interval });
    else previous.end = Math.max(previous.end, interval.end);
  }
  return merged;
}

function overlap(start: number, end: number, rangeStart: number, rangeEnd: number) {
  return Math.max(0, Math.min(end, rangeEnd) - Math.max(start, rangeStart));
}

function intervalMinutes(intervals: Interval[], rangeStart: number, rangeEnd: number) {
  return intervals.reduce((sum, interval) => sum + overlap(interval.start, interval.end, rangeStart, rangeEnd), 0);
}

function recordedBreakMinutes(intervals: Interval[], open: number, close: number) {
  const core = intervals.map((item) => ({ start: Math.max(item.start, open), end: Math.min(item.end, close) })).filter((item) => item.end > item.start);
  return core.slice(1).reduce((sum, item, index) => sum + Math.max(0, item.start - core[index].end), 0);
}

function commonMinute(values: number[]) {
  if (!values.length) return null;
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value % 1440, (counts.get(value % 1440) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

function average(values: number[]) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function statusFor(row: Pick<DailyAttendanceRow, 'flags'>, leave: ReportingLeave | undefined, holiday: boolean, scheduled: boolean, date: string, today: string): AttendanceStatus {
  if (row.flags.missingClockIn) return 'Missing clock-in';
  if (row.flags.missingClockOut) return 'Missing clock-out';
  if (row.flags.incomplete) return 'Incomplete';
  if (row.flags.late && row.flags.early) return 'Late and early departure';
  if (row.flags.late) return 'Late';
  if (row.flags.early) return 'Early departure';
  if (leave?.type === 'annual') return 'Annual leave';
  if (leave?.type === 'sick') return 'Sick leave';
  if (leave?.type === 'family_responsibility') return 'Family responsibility leave';
  if (holiday && !row.flags.overtime) return 'Public holiday';
  if (row.flags.absent) return date === today ? 'Not clocked in' : 'Absent';
  if (!scheduled && !row.flags.overtime && !row.flags.adjusted) return 'Not scheduled';
  return 'Complete';
}

export function calculateAttendanceReport(input: {
  employees: ReportingEmployee[];
  records: ReportingRecord[];
  schedules: ReportingSchedule[];
  publicHolidayDates: Iterable<string>;
  leave: ReportingLeave[];
  reportStart: string;
  reportEnd: string;
  today: string;
  filters?: ReportFilters;
}) {
  const holidays = new Set(input.publicHolidayDates);
  const recordsByEmployeeDate = new Map<string, ReportingRecord[]>();
  for (const record of input.records) {
    const key = `${record.staffId}|${record.date}`;
    recordsByEmployeeDate.set(key, [...(recordsByEmployeeDate.get(key) ?? []), record]);
  }

  const saturdayDates = new Map<string, Set<string>>();
  for (const record of input.records) {
    if (isoDay(record.date) !== 6 || record.clockInMinute === null || record.clockOutMinute === null || record.clockOutMinute <= record.clockInMinute) continue;
    const key = `${record.staffId}|${record.date.slice(0, 7)}`;
    const dates = saturdayDates.get(key) ?? new Set<string>();
    dates.add(record.date);
    saturdayDates.set(key, dates);
  }
  const ordinarySaturdays = new Set<string>();
  for (const [key, dates] of saturdayDates) [...dates].sort().slice(0, ORDINARY_SATURDAYS_PER_MONTH).forEach((date) => ordinarySaturdays.add(`${key}|${date}`));

  const allDates = enumerateDates(classificationStart(input.reportStart), input.reportEnd);
  const days: DayAllocation[] = [];
  for (const employee of input.employees) {
    for (const date of allDates) {
      if (employee.employmentStartDate && date < employee.employmentStartDate) continue;
      if (employee.employmentEndDate && date > employee.employmentEndDate) continue;
      const dayOfWeek = isoDay(date);
      const schedule = input.schedules.find((item) => item.dayOfWeek === dayOfWeek);
      const hasSchedule = schedule?.opensAtMinute !== null && schedule?.opensAtMinute !== undefined && schedule.closesAtMinute !== null;
      const open = hasSchedule ? schedule.opensAtMinute! : 0;
      const close = hasSchedule ? schedule.closesAtMinute! : 24 * 60;
      const records = recordsByEmployeeDate.get(`${employee.id}|${date}`) ?? [];
      const validIntervals = mergeIntervals(records.filter((record) => record.clockInMinute !== null && record.clockOutMinute !== null && record.clockOutMinute > record.clockInMinute).map((record) => ({ start: Math.max(record.clockInMinute!, open), end: record.clockOutMinute! })));
      const missingClockIn = records.some((record) => record.clockInMinute === null && record.clockOutMinute !== null);
      const missingClockOut = records.some((record) => record.clockInMinute !== null && record.clockOutMinute === null);
      const invalid = records.some((record) => record.clockInMinute !== null && record.clockOutMinute !== null && record.clockOutMinute <= record.clockInMinute);
      const recordedBreak = hasSchedule ? recordedBreakMinutes(validIntervals, open, close) : 0;
      const automaticBreak = hasSchedule && validIntervals.length ? Math.max(0, (schedule?.unpaidBreakMinutes ?? 0) - recordedBreak) : 0;
      const payableCore = hasSchedule ? Math.max(0, intervalMinutes(validIntervals, open, close) - automaticBreak) : intervalMinutes(validIntervals, 0, 48 * 60);
      const overtimeStart = hasSchedule && dayOfWeek <= 5 ? close + WEEKDAY_GRACE_MINUTES : close;
      const payableExtra = hasSchedule ? intervalMinutes(validIntervals, overtimeStart, 48 * 60) : 0;
      const holiday = holidays.has(date);
      const doubleTime = dayOfWeek === 7 || holiday;
      const ordinarySaturday = dayOfWeek === 6 && ordinarySaturdays.has(`${employee.id}|${date.slice(0, 7)}|${date}`);
      const regularDay = dayOfWeek <= 5 || ordinarySaturday;
      const scheduled = hasSchedule && !doubleTime && regularDay;
      const leave = input.leave.find((item) => item.staffId === employee.id && item.status === 'approved' && item.startDate <= date && item.endDate >= date);
      const firstIn = records.map((record) => record.clockInMinute).filter((value): value is number => value !== null).sort((a, b) => a - b)[0] ?? null;
      const lastOut = records.map((record) => record.clockOutMinute).filter((value): value is number => value !== null).sort((a, b) => b - a)[0] ?? null;
      const lateMinutes = scheduled && firstIn !== null ? Math.max(0, firstIn - open) : 0;
      const earlyDepartureMinutes = scheduled && lastOut !== null ? Math.max(0, close - lastOut) : 0;
      const adjusted = records.some((record) => record.source === 'administrator_adjustment');
      const hasAnyRecord = records.length > 0;
      const absent = scheduled && !hasAnyRecord && !leave;
      const normalMinutes = !doubleTime && regularDay ? payableCore : 0;
      const overtimeCandidateMinutes = !doubleTime ? (regularDay ? payableExtra : payableCore + payableExtra) : 0;
      const overtimeDoubleMinutes = doubleTime ? payableCore + payableExtra : 0;
      const flags = { late: lateMinutes > 0, early: earlyDepartureMinutes > 0, missingClockIn, missingClockOut, absent, incomplete: missingClockIn || missingClockOut || invalid, adjusted, overtime: overtimeCandidateMinutes + overtimeDoubleMinutes > 0 };
      const overtimeReason = overtimeDoubleMinutes > 0
        ? (holiday ? 'South African public holiday work' : 'Sunday work')
        : overtimeCandidateMinutes > 0
          ? (dayOfWeek === 6 && !ordinarySaturday ? 'Additional Saturday after the first two worked Saturdays' : dayOfWeek === 6 ? 'Saturday time beyond scheduled hours' : 'Weekday time after the 17:30 overtime threshold')
          : null;
      const notes = [...new Set(records.map((record) => record.adjustmentReason).filter((value): value is string => Boolean(value)))].join('; ');
      const row: DayAllocation = {
        id: `${employee.id}|${date}`,
        attendanceRecordId: records.length === 1 ? records[0].id : null,
        attendanceRecords: records.map((record) => ({ id: record.id, clockInMinute: record.clockInMinute, clockOutMinute: record.clockOutMinute, source: record.source ?? 'employee_clocking', notes: record.adjustmentReason ?? '' })),
        employeeId: employee.id,
        employeeName: employee.name,
        branchId: employee.branchId,
        branchName: employee.branchName,
        department: employee.department ?? null,
        date,
        dayOfWeek: DAY_NAMES[dayOfWeek - 1],
        scheduledStartMinute: hasSchedule ? open : null,
        actualClockInMinute: firstIn,
        scheduledFinishMinute: hasSchedule ? close : null,
        actualClockOutMinute: lastOut,
        recordedBreakMinutes: recordedBreak,
        automaticBreakMinutes: automaticBreak,
        normalMinutes,
        overtimeOneHalfMinutes: 0,
        overtimeDoubleMinutes,
        totalOvertimeMinutes: overtimeDoubleMinutes,
        totalWorkedMinutes: normalMinutes + overtimeDoubleMinutes,
        lateMinutes,
        earlyDepartureMinutes,
        status: 'Complete',
        source: adjusted ? 'administrator_adjustment' : hasAnyRecord ? 'employee_clocking' : 'system',
        notes,
        scheduledMinutes: hasSchedule ? Math.max(0, close - open - (schedule?.unpaidBreakMinutes ?? 0)) : 0,
        scheduledDay: scheduled,
        qualifyingOvertimeMinutes: overtimeCandidateMinutes + overtimeDoubleMinutes,
        overtimeReason,
        overtimeApprovalStatus: null,
        flags,
        overtimeCandidateMinutes,
        doubleTime,
      };
      row.status = statusFor(row, leave, holiday, scheduled, date, input.today);
      days.push(row);
    }
  }

  const weeks = new Map<string, DayAllocation[]>();
  for (const day of days) {
    const key = `${day.employeeId}|${weekStart(day.date)}`;
    weeks.set(key, [...(weeks.get(key) ?? []), day]);
  }
  for (const weekDays of weeks.values()) {
    const monday = weekStart(weekDays[0].date);
    const employee = input.employees.find((item) => item.id === weekDays[0].employeeId);
    let required = 0;
    for (let offset = 0; offset < 5; offset += 1) {
      const date = addDays(monday, offset);
      if (holidays.has(date)) continue;
      if (employee?.employmentStartDate && date < employee.employmentStartDate) continue;
      if (employee?.employmentEndDate && date > employee.employmentEndDate) continue;
      const schedule = input.schedules.find((item) => item.dayOfWeek === offset + 1);
      if (schedule?.opensAtMinute !== null && schedule?.opensAtMinute !== undefined && schedule.closesAtMinute !== null) required += Math.max(0, schedule.closesAtMinute - schedule.opensAtMinute - schedule.unpaidBreakMinutes);
    }
    required += weekDays.filter((day) => isoDay(day.date) === 6 && day.scheduledDay).reduce((sum, day) => sum + day.scheduledMinutes, 0);
    let deficit = Math.max(0, required - weekDays.reduce((sum, day) => sum + day.normalMinutes, 0));
    for (const day of weekDays.slice().sort((a, b) => a.date.localeCompare(b.date))) {
      const topUp = Math.min(day.overtimeCandidateMinutes, deficit);
      day.normalMinutes += topUp;
      day.overtimeOneHalfMinutes = day.overtimeCandidateMinutes - topUp;
      day.totalOvertimeMinutes = day.overtimeOneHalfMinutes + day.overtimeDoubleMinutes;
      day.totalWorkedMinutes = day.normalMinutes + day.totalOvertimeMinutes;
      day.qualifyingOvertimeMinutes = day.totalOvertimeMinutes;
      day.flags.overtime = day.totalOvertimeMinutes > 0;
      if (!day.flags.overtime && day.overtimeCandidateMinutes > 0) day.overtimeReason = 'Allocated to outstanding weekly normal hours';
      deficit -= topUp;
    }
  }

  const periodRows = days.filter((day) => day.date >= input.reportStart && day.date <= input.reportEnd);
  const filteredRows = applyReportFilters(periodRows, input.filters ?? {}).sort((a, b) => b.date.localeCompare(a.date) || a.branchName.localeCompare(b.branchName) || a.employeeName.localeCompare(b.employeeName));
  const employees = input.employees.filter((employee) => filteredRows.some((row) => row.employeeId === employee.id));
  const summary = employees.map((employee): SummaryRow => {
    const rows = filteredRows.filter((row) => row.employeeId === employee.id);
    return {
      employeeId: employee.id, employeeName: employee.name, branchId: employee.branchId, branchName: employee.branchName,
      daysLoggedInCount: rows.filter((row) => row.actualClockInMinute !== null || (row.flags.adjusted && row.attendanceRecords.length > 0 && row.actualClockOutMinute === null && row.notes.startsWith('Attendance confirmed by administrator'))).length,
      normalMinutes: rows.reduce((sum, row) => sum + row.normalMinutes, 0),
      overtimeOneHalfMinutes: rows.reduce((sum, row) => sum + row.overtimeOneHalfMinutes, 0),
      overtimeDoubleMinutes: rows.reduce((sum, row) => sum + row.overtimeDoubleMinutes, 0),
      totalOvertimeMinutes: rows.reduce((sum, row) => sum + row.totalOvertimeMinutes, 0),
      totalWorkedMinutes: rows.reduce((sum, row) => sum + row.totalWorkedMinutes, 0),
      lateArrivalCount: rows.filter((row) => row.flags.late).length,
      absenceCount: rows.filter((row) => row.status === 'Absent').length,
      incompleteRecordCount: rows.filter((row) => row.flags.incomplete).length,
    };
  }).sort((a, b) => `${a.branchName}|${a.employeeName}`.localeCompare(`${b.branchName}|${b.employeeName}`));

  const patterns = summary.map((item): PatternRow => {
    const rows = filteredRows.filter((row) => row.employeeId === item.employeeId);
    const worked = rows.filter((row) => row.totalWorkedMinutes > 0);
    const ins = worked.map((row) => row.actualClockInMinute).filter((value): value is number => value !== null);
    const outs = worked.map((row) => row.actualClockOutMinute).filter((value): value is number => value !== null);
    return {
      ...item,
      totalDaysScheduled: rows.filter((row) => row.scheduledDay).length,
      totalDaysWorked: worked.length,
      totalLateMinutes: rows.reduce((sum, row) => sum + row.lateMinutes, 0),
      averageClockInMinute: average(ins),
      earlyDepartureCount: rows.filter((row) => row.flags.early).length,
      totalEarlyDepartureMinutes: rows.reduce((sum, row) => sum + row.earlyDepartureMinutes, 0),
      missingClockInCount: rows.filter((row) => row.flags.missingClockIn).length,
      missingClockOutCount: rows.filter((row) => row.flags.missingClockOut).length,
      averageDailyMinutes: worked.length ? Math.round(item.totalWorkedMinutes / worked.length) : 0,
      manualAdjustmentCount: rows.filter((row) => row.flags.adjusted).length,
      mostCommonClockInMinute: commonMinute(ins),
      mostCommonClockOutMinute: commonMinute(outs),
    };
  });

  const overtime: OvertimeDetailRow[] = filteredRows.flatMap((row) => {
    const shared = { employeeId: row.employeeId, employeeName: row.employeeName, branchId: row.branchId, branchName: row.branchName, date: row.date, dayOfWeek: row.dayOfWeek, scheduledMinutes: row.scheduledMinutes, actualMinutes: row.totalWorkedMinutes + row.recordedBreakMinutes + row.automaticBreakMinutes, breakDeductionMinutes: row.recordedBreakMinutes + row.automaticBreakMinutes, reason: row.overtimeReason ?? 'Overtime rule', source: row.flags.adjusted ? 'Manually adjusted' as const : 'Automatically calculated' as const, approvalStatus: row.overtimeApprovalStatus ?? 'Not configured' };
    return [
      ...(row.overtimeOneHalfMinutes ? [{ id: `${row.id}|1.5`, ...shared, qualifyingOvertimeMinutes: row.overtimeOneHalfMinutes, rate: '1.5×' as const }] : []),
      ...(row.overtimeDoubleMinutes ? [{ id: `${row.id}|2`, ...shared, qualifyingOvertimeMinutes: row.overtimeDoubleMinutes, rate: '2×' as const }] : []),
    ];
  });

  const trendMap = new Map<string, WeeklyTrend>();
  for (const row of filteredRows) {
    const key = weekStart(row.date);
    const trend = trendMap.get(key) ?? { weekStart: key, normalMinutes: 0, overtimeMinutes: 0, lateArrivals: 0, absences: 0, incompleteRecords: 0 };
    trend.normalMinutes += row.normalMinutes;
    trend.overtimeMinutes += row.totalOvertimeMinutes;
    trend.lateArrivals += Number(row.flags.late);
    trend.absences += Number(row.status === 'Absent');
    trend.incompleteRecords += Number(row.flags.incomplete);
    trendMap.set(key, trend);
  }

  return { daily: filteredRows, summary, patterns, overtime, trends: [...trendMap.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart)) };
}

export function applyReportFilters(rows: DailyAttendanceRow[], filters: ReportFilters) {
  const search = filters.search?.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (filters.branchIds?.length && !filters.branchIds.includes(row.branchId)) return false;
    if (filters.employeeId && row.employeeId !== filters.employeeId) return false;
    if (search && !row.employeeName.toLocaleLowerCase().includes(search)) return false;
    if (filters.department && row.department !== filters.department) return false;
    if (filters.statuses?.length && !filters.statuses.includes(row.status)) return false;
    if (filters.hasNormalHours && row.normalMinutes <= 0) return false;
    if (filters.hasOvertime && row.totalOvertimeMinutes <= 0) return false;
    if (filters.missingClockIn && !row.flags.missingClockIn) return false;
    if (filters.missingClockOut && !row.flags.missingClockOut) return false;
    if (filters.late && !row.flags.late) return false;
    if (filters.early && !row.flags.early) return false;
    if (filters.absent && row.status !== 'Absent') return false;
    if (filters.incomplete && !row.flags.incomplete) return false;
    return true;
  });
}

export function sumSummary(rows: SummaryRow[]) {
  return rows.reduce((total, row) => ({
    daysLoggedInCount: total.daysLoggedInCount + row.daysLoggedInCount,
    normalMinutes: total.normalMinutes + row.normalMinutes,
    overtimeOneHalfMinutes: total.overtimeOneHalfMinutes + row.overtimeOneHalfMinutes,
    overtimeDoubleMinutes: total.overtimeDoubleMinutes + row.overtimeDoubleMinutes,
    totalOvertimeMinutes: total.totalOvertimeMinutes + row.totalOvertimeMinutes,
    totalWorkedMinutes: total.totalWorkedMinutes + row.totalWorkedMinutes,
    lateArrivalCount: total.lateArrivalCount + row.lateArrivalCount,
    absenceCount: total.absenceCount + row.absenceCount,
    incompleteRecordCount: total.incompleteRecordCount + row.incompleteRecordCount,
  }), { daysLoggedInCount: 0, normalMinutes: 0, overtimeOneHalfMinutes: 0, overtimeDoubleMinutes: 0, totalOvertimeMinutes: 0, totalWorkedMinutes: 0, lateArrivalCount: 0, absenceCount: 0, incompleteRecordCount: 0 });
}

export function formatMinutes(minutes: number) {
  const safe = Math.max(0, Math.round(minutes));
  return `${Math.floor(safe / 60)}h ${String(safe % 60).padStart(2, '0')}m`;
}

export function formatClockMinute(value: number | null) {
  if (value === null) return '—';
  const minute = ((value % 1440) + 1440) % 1440;
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
