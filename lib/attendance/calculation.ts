import { applyMinimumOvertime } from './overtime-policy.ts';

export type AttendanceCalculationInput = {
  id: string;
  staffId: string;
  date: string;
  clockInMinute: number;
  clockOutMinute: number | null;
};

export type WorkScheduleInput = {
  dayOfWeek: number;
  opensAtMinute: number | null;
  closesAtMinute: number | null;
  unpaidBreakMinutes: number;
};

export type HoursBreakdown = {
  worked: number;
  ordinary: number;
  overtime: number;
  publicHoliday: number;
};

type RecordMinutes = {
  id: string;
  core: number;
  extra: number;
  ordinary: number;
  overtime: number;
  publicHoliday: number;
};

type DayCalculation = {
  staffId: string;
  date: string;
  weekKey: string;
  requiredOrdinary: number;
  records: RecordMinutes[];
};

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

function uncoveredMinutes(intervals: Array<{ start: number; end: number }>) {
  if (intervals.length < 2) return 0;
  const sorted = intervals.slice().sort((a, b) => a.start - b.start);
  let uncovered = 0;
  let coveredUntil = sorted[0].end;
  for (const interval of sorted.slice(1)) {
    if (interval.start > coveredUntil) uncovered += interval.start - coveredUntil;
    coveredUntil = Math.max(coveredUntil, interval.end);
  }
  return uncovered;
}

function distribute(total: number, weights: number[]) {
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  if (!weightTotal || !total) return weights.map(() => 0);
  return weights.map((weight) => total * weight / weightTotal);
}

function roundHours(minutes: number) {
  return Math.round((minutes / 60) * 10) / 10;
}

/**
 * Applies the Pits attendance rules in local South African wall-clock minutes.
 * Early arrivals are ignored, weekday time from 17:00 through 17:30 is a
 * clock-out grace period, and a missing meal clock-out is topped up to a full
 * 60-minute unpaid break. The first two Saturdays actually worked in each
 * employee's calendar month are ordinary scheduled days.
 */
export function calculateAttendanceHours(
  input: AttendanceCalculationInput[],
  schedules: WorkScheduleInput[],
  publicHolidayDates: Iterable<string>,
) {
  const holidays = new Set(publicHolidayDates);
  const completed = input.filter((record) => record.clockOutMinute !== null && record.clockOutMinute > record.clockInMinute);
  const saturdayDatesByEmployeeMonth = new Map<string, string[]>();

  for (const record of completed) {
    if (isoDay(record.date) !== 6) continue;
    const key = `${record.staffId}-${record.date.slice(0, 7)}`;
    const dates = saturdayDatesByEmployeeMonth.get(key) ?? [];
    if (!dates.includes(record.date)) dates.push(record.date);
    saturdayDatesByEmployeeMonth.set(key, dates.sort());
  }

  const ordinarySaturdays = new Set<string>();
  for (const [key, dates] of saturdayDatesByEmployeeMonth) {
    for (const date of dates.slice(0, ORDINARY_SATURDAYS_PER_MONTH)) ordinarySaturdays.add(`${key}-${date}`);
  }

  const grouped = new Map<string, AttendanceCalculationInput[]>();
  for (const record of completed) {
    const key = `${record.staffId}-${record.date}`;
    grouped.set(key, [...(grouped.get(key) ?? []), record]);
  }

  const days: DayCalculation[] = [];
  for (const records of grouped.values()) {
    records.sort((a, b) => a.clockInMinute - b.clockInMinute);
    const { staffId, date } = records[0];
    const dayOfWeek = isoDay(date);
    const schedule = schedules.find((item) => item.dayOfWeek === dayOfWeek);
    const isHoliday = holidays.has(date);
    const isOrdinarySaturday = dayOfWeek === 6 && ordinarySaturdays.has(`${staffId}-${date.slice(0, 7)}-${date}`);
    const isRegularDay = dayOfWeek >= 1 && dayOfWeek <= 5 || isOrdinarySaturday;
    const hasSchedule = schedule?.opensAtMinute !== null && schedule?.opensAtMinute !== undefined && schedule.closesAtMinute !== null;
    const open = hasSchedule ? schedule.opensAtMinute! : 0;
    const close = hasSchedule ? schedule.closesAtMinute! : 24 * 60;
    const overtimeStart = hasSchedule && dayOfWeek >= 1 && dayOfWeek <= 5 ? close + WEEKDAY_OVERTIME_GRACE_MINUTES : close;
    const coreWeights = records.map((record) => overlap(record.clockInMinute, record.clockOutMinute!, open, close));
    const extraWeights = records.map((record) => overlap(record.clockInMinute, record.clockOutMinute!, overtimeStart, 48 * 60));
    const coreIntervals = records
      .map((record) => ({ start: Math.max(record.clockInMinute, open), end: Math.min(record.clockOutMinute!, close) }))
      .filter((interval) => interval.end > interval.start);
    const recordedBreak = uncoveredMinutes(coreIntervals);
    const breakDeduction = hasSchedule ? Math.max(0, (schedule?.unpaidBreakMinutes ?? 0) - recordedBreak) : 0;
    const payableCore = Math.max(0, coreWeights.reduce((sum, value) => sum + value, 0) - breakDeduction);
    const coreShares = distribute(payableCore, coreWeights);
    const recordMinutes: RecordMinutes[] = records.map((record, index) => ({
      id: record.id,
      core: coreShares[index],
      extra: extraWeights[index],
      ordinary: 0,
      overtime: 0,
      publicHoliday: 0,
    }));

    for (const record of recordMinutes) {
      if (isHoliday) record.publicHoliday = record.core + record.extra;
      else if (isRegularDay) record.ordinary = record.core;
      else record.overtime = record.core + record.extra;
    }

    const scheduledNet = isRegularDay && hasSchedule ? Math.max(0, close - open - (schedule?.unpaidBreakMinutes ?? 0)) : 0;
    days.push({ staffId, date, weekKey: `${staffId}-${weekStart(date)}`, requiredOrdinary: isHoliday ? 0 : scheduledNet, records: recordMinutes });
  }

  const weeks = new Map<string, DayCalculation[]>();
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
    required += weekDays.reduce((sum, day) => isoDay(day.date) === 6 ? sum + day.requiredOrdinary : sum, 0);

    const ordinaryBase = weekDays.flatMap((day) => day.records).reduce((sum, record) => sum + record.ordinary, 0);
    let deficit = Math.max(0, required - ordinaryBase);
    const overtimeCandidates = weekDays
      .flatMap((day) => day.records.map((record) => ({ date: day.date, record })))
      .filter(({ record }) => (record.publicHoliday === 0 && record.extra > 0) || record.overtime > 0)
      .sort((a, b) => `${a.date}-${a.record.id}`.localeCompare(`${b.date}-${b.record.id}`));

    for (const { record } of overtimeCandidates) {
      const candidate = record.overtime > 0 ? record.overtime : record.extra;
      record.overtime = 0;
      const ordinaryTopUp = Math.min(candidate, deficit);
      record.ordinary += ordinaryTopUp;
      record.overtime = candidate - ordinaryTopUp;
      deficit -= ordinaryTopUp;
    }
  }

  for (const day of days) {
    const overtimeTotal = day.records.reduce((sum, record) => sum + record.overtime, 0);
    const publicHolidayTotal = day.records.reduce((sum, record) => sum + record.publicHoliday, 0);
    let payableOvertime = applyMinimumOvertime(overtimeTotal);
    let payablePublicHoliday = applyMinimumOvertime(publicHolidayTotal);
    for (const record of day.records) {
      record.overtime = Math.min(record.overtime, payableOvertime);
      payableOvertime -= record.overtime;
      record.publicHoliday = Math.min(record.publicHoliday, payablePublicHoliday);
      payablePublicHoliday -= record.publicHoliday;
    }
  }

  const result = new Map<string, HoursBreakdown>();
  for (const record of input) result.set(record.id, { worked: 0, ordinary: 0, overtime: 0, publicHoliday: 0 });
  for (const day of days) {
    for (const record of day.records) {
      const worked = record.ordinary + record.overtime + record.publicHoliday;
      result.set(record.id, {
        worked: roundHours(worked),
        ordinary: roundHours(record.ordinary),
        overtime: roundHours(record.overtime),
        publicHoliday: roundHours(record.publicHoliday),
      });
    }
  }
  return result;
}

export function timeToMinute(value: string | null) {
  if (!value) return null;
  const [hour, minute] = value.split(':').map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
}
