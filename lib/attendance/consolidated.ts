import type { WorkScheduleInput } from './calculation';
import { applyMinimumOvertime } from './overtime-policy.ts';

export type ConsolidatedAttendanceInput = {
  id: string;
  staffId: string;
  date: string;
  clockInMinute: number;
  clockOutMinute: number | null;
};

export type ConsolidatedMinutes = {
  normalMinutes: number;
  overtimeOneHalfMinutes: number;
  overtimeDoubleMinutes: number;
};

type Interval = { start: number; end: number };
type DayAllocation = ConsolidatedMinutes & {
  staffId: string;
  date: string;
  weekKey: string;
  requiredNormalMinutes: number;
  overtimeCandidateMinutes: number;
};

const EARLIEST_COUNTED_MINUTE = 7 * 60 + 30;
const WEEKDAY_OVERTIME_GRACE_MINUTES = 30;
const ORDINARY_SATURDAYS_PER_MONTH = 2;

function isoDay(date: string) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekStart(date: string) {
  return addDays(date, 1 - isoDay(date));
}

function overlap(start: number, end: number, rangeStart: number, rangeEnd: number) {
  return Math.max(0, Math.min(end, rangeEnd) - Math.max(start, rangeStart));
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

function intervalMinutes(intervals: Interval[], rangeStart: number, rangeEnd: number) {
  return intervals.reduce((sum, interval) => sum + overlap(interval.start, interval.end, rangeStart, rangeEnd), 0);
}

function uncoveredMinutes(intervals: Interval[]) {
  if (intervals.length < 2) return 0;
  return intervals.slice(1).reduce((sum, interval, index) => sum + Math.max(0, interval.start - intervals[index].end), 0);
}

/**
 * Calculates the consolidated report in whole minutes. The caller supplies
 * lookback records needed for weekly thresholds and Saturday ranking, while
 * only dates inside reportStart/reportEnd are included in the returned totals.
 */
export function calculateConsolidatedMinutes(
  input: ConsolidatedAttendanceInput[],
  schedules: WorkScheduleInput[],
  publicHolidayDates: Iterable<string>,
  reportStart: string,
  reportEnd: string,
) {
  const holidays = new Set(publicHolidayDates);
  const completed = input.filter((record) => record.clockOutMinute !== null && record.clockOutMinute > record.clockInMinute);
  const grouped = new Map<string, ConsolidatedAttendanceInput[]>();
  for (const record of completed) {
    const key = `${record.staffId}|${record.date}`;
    grouped.set(key, [...(grouped.get(key) ?? []), record]);
  }

  const saturdayDates = new Map<string, Set<string>>();
  for (const record of completed) {
    if (isoDay(record.date) !== 6) continue;
    const key = `${record.staffId}|${record.date.slice(0, 7)}`;
    const dates = saturdayDates.get(key) ?? new Set<string>();
    dates.add(record.date);
    saturdayDates.set(key, dates);
  }
  const ordinarySaturdays = new Set<string>();
  for (const [key, dates] of saturdayDates) {
    [...dates].sort().slice(0, ORDINARY_SATURDAYS_PER_MONTH).forEach((date) => ordinarySaturdays.add(`${key}|${date}`));
  }

  const days: DayAllocation[] = [];
  for (const records of grouped.values()) {
    const { staffId, date } = records[0];
    const dayOfWeek = isoDay(date);
    const schedule = schedules.find((item) => item.dayOfWeek === dayOfWeek);
    const hasSchedule = schedule?.opensAtMinute !== null && schedule?.opensAtMinute !== undefined && schedule.closesAtMinute !== null;
    const open = hasSchedule ? schedule.opensAtMinute! : EARLIEST_COUNTED_MINUTE;
    const close = hasSchedule ? schedule.closesAtMinute! : 48 * 60;
    const intervals = mergeIntervals(records.map((record) => ({
      start: Math.max(record.clockInMinute, EARLIEST_COUNTED_MINUTE, open),
      end: record.clockOutMinute!,
    })));
    const coreIntervals = intervals
      .map((interval) => ({ start: Math.max(interval.start, open), end: Math.min(interval.end, close) }))
      .filter((interval) => interval.end > interval.start);
    const recordedBreak = uncoveredMinutes(coreIntervals);
    const breakDeduction = hasSchedule ? Math.max(0, (schedule?.unpaidBreakMinutes ?? 0) - recordedBreak) : 0;
    const payableCore = Math.max(0, intervalMinutes(intervals, open, close) - breakDeduction);
    const overtimeStart = hasSchedule && dayOfWeek >= 1 && dayOfWeek <= 5 ? close + WEEKDAY_OVERTIME_GRACE_MINUTES : close;
    const payableExtra = intervalMinutes(intervals, overtimeStart, 48 * 60);
    const isDoubleTime = holidays.has(date);
    const isOrdinarySaturday = dayOfWeek === 6 && ordinarySaturdays.has(`${staffId}|${date.slice(0, 7)}|${date}`);
    const isRegularDay = (dayOfWeek >= 1 && dayOfWeek <= 5) || isOrdinarySaturday;

    days.push({
      staffId,
      date,
      weekKey: `${staffId}|${weekStart(date)}`,
      requiredNormalMinutes: !isDoubleTime && isRegularDay && hasSchedule ? Math.max(0, close - open - (schedule?.unpaidBreakMinutes ?? 0)) : 0,
      normalMinutes: !isDoubleTime && isRegularDay ? payableCore : 0,
      overtimeCandidateMinutes: !isDoubleTime ? (isRegularDay ? payableExtra : payableCore + payableExtra) : 0,
      overtimeOneHalfMinutes: 0,
      overtimeDoubleMinutes: isDoubleTime ? payableCore + payableExtra : 0,
    });
  }

  const weeks = new Map<string, DayAllocation[]>();
  for (const day of days) weeks.set(day.weekKey, [...(weeks.get(day.weekKey) ?? []), day]);
  for (const weekDays of weeks.values()) {
    const monday = weekStart(weekDays[0].date);
    let required = 0;
    for (let offset = 0; offset < 5; offset += 1) {
      const date = addDays(monday, offset);
      if (holidays.has(date)) continue;
      const schedule = schedules.find((item) => item.dayOfWeek === offset + 1);
      if (schedule?.opensAtMinute !== null && schedule?.opensAtMinute !== undefined && schedule.closesAtMinute !== null) {
        required += Math.max(0, schedule.closesAtMinute - schedule.opensAtMinute - schedule.unpaidBreakMinutes);
      }
    }
    required += weekDays.reduce((sum, day) => isoDay(day.date) === 6 ? sum + day.requiredNormalMinutes : sum, 0);
    let deficit = Math.max(0, required - weekDays.reduce((sum, day) => sum + day.normalMinutes, 0));
    for (const day of weekDays.slice().sort((a, b) => a.date.localeCompare(b.date))) {
      const normalTopUp = isoDay(day.date) === 7 ? 0 : Math.min(day.overtimeCandidateMinutes, deficit);
      day.normalMinutes += normalTopUp;
      day.overtimeOneHalfMinutes = applyMinimumOvertime(day.overtimeCandidateMinutes - normalTopUp);
      day.overtimeDoubleMinutes = applyMinimumOvertime(day.overtimeDoubleMinutes);
      deficit -= normalTopUp;
    }
  }

  const totals = new Map<string, ConsolidatedMinutes>();
  for (const record of input) totals.set(record.staffId, { normalMinutes: 0, overtimeOneHalfMinutes: 0, overtimeDoubleMinutes: 0 });
  for (const day of days.filter((item) => item.date >= reportStart && item.date <= reportEnd)) {
    const total = totals.get(day.staffId) ?? { normalMinutes: 0, overtimeOneHalfMinutes: 0, overtimeDoubleMinutes: 0 };
    total.normalMinutes += day.normalMinutes;
    total.overtimeOneHalfMinutes += day.overtimeOneHalfMinutes;
    total.overtimeDoubleMinutes += day.overtimeDoubleMinutes;
    totals.set(day.staffId, total);
  }
  return totals;
}

export function formatMinutes(minutes: number) {
  const safeMinutes = Math.max(0, Math.round(minutes));
  return `${Math.floor(safeMinutes / 60)}h ${String(safeMinutes % 60).padStart(2, '0')}m`;
}

export function managementReportPeriod(reference = new Date(), timeZone = 'Africa/Johannesburg') {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(reference);
  const reportDate = addDays(today, -1);
  const month = new Date(`${reportDate.slice(0, 7)}-01T12:00:00Z`);
  month.setUTCMonth(month.getUTCMonth() - 1);
  return { reportDate, periodStart: `${month.toISOString().slice(0, 7)}-25`, periodEnd: reportDate };
}
