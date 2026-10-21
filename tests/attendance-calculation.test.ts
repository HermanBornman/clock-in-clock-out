import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAttendanceHours, type AttendanceCalculationInput, type WorkScheduleInput } from '../lib/attendance/calculation.ts';
import { classifyDailyStatus } from '../lib/attendance/daily-status.ts';

const schedules: WorkScheduleInput[] = [
  ...[1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, opensAtMinute: 7 * 60 + 30, closesAtMinute: 17 * 60, unpaidBreakMinutes: 60 })),
  { dayOfWeek: 6, opensAtMinute: 8 * 60, closesAtMinute: 13 * 60, unpaidBreakMinutes: 30 },
  { dayOfWeek: 7, opensAtMinute: null, closesAtMinute: null, unpaidBreakMinutes: 0 },
];

function record(id: string, date: string, start: string, end: string, staffId = 'staff-1'): AttendanceCalculationInput {
  const minute = (value: string) => { const [hour, part] = value.split(':').map(Number); return hour * 60 + part; };
  return { id, staffId, date, clockInMinute: minute(start), clockOutMinute: minute(end) };
}

test('ignores weekday clock-in time before 07:30 and deducts one hour for lunch', () => {
  const result = calculateAttendanceHours([record('shift', '2026-09-07', '06:45', '17:00')], schedules, []).get('shift');
  assert.deepEqual(result, { worked: 8.5, ordinary: 8.5, overtime: 0, publicHoliday: 0 });
});

test('does not count the 17:00 to 17:30 clock-out grace period', () => {
  const result = calculateAttendanceHours([record('shift', '2026-09-07', '07:30', '17:25')], schedules, []).get('shift');
  assert.deepEqual(result, { worked: 8.5, ordinary: 8.5, overtime: 0, publicHoliday: 0 });
});

test('retains overtime only when time after 17:30 reaches a full hour', () => {
  const week = [
    record('mon', '2026-09-07', '07:30', '17:00'), record('tue', '2026-09-08', '07:30', '17:00'),
    record('wed', '2026-09-09', '07:30', '17:00'), record('thu', '2026-09-10', '07:30', '17:00'),
    record('fri', '2026-09-11', '07:30', '18:30'),
  ];
  const result = calculateAttendanceHours(week, schedules, []);
  assert.deepEqual(result.get('fri'), { worked: 9.5, ordinary: 8.5, overtime: 1, publicHoliday: 0 });
});

test('drops daily overtime below 60 minutes', () => {
  const week = [
    record('mon', '2026-09-07', '07:30', '17:00'), record('tue', '2026-09-08', '07:30', '17:00'),
    record('wed', '2026-09-09', '07:30', '17:00'), record('thu', '2026-09-10', '07:30', '17:00'),
    record('fri', '2026-09-11', '07:30', '18:29'),
  ];
  assert.deepEqual(calculateAttendanceHours(week, schedules, []).get('fri'), { worked: 8.5, ordinary: 8.5, overtime: 0, publicHoliday: 0 });
});

test('uses extra time to complete missing weekly ordinary hours before overtime', () => {
  const week = [
    record('mon', '2026-09-07', '08:30', '17:00'), record('tue', '2026-09-08', '07:30', '17:00'),
    record('wed', '2026-09-09', '07:30', '17:00'), record('thu', '2026-09-10', '07:30', '17:00'),
    record('fri', '2026-09-11', '07:30', '19:30'),
  ];
  const result = calculateAttendanceHours(week, schedules, []);
  assert.deepEqual(result.get('fri'), { worked: 10.5, ordinary: 9.5, overtime: 1, publicHoliday: 0 });
});

test('recognises only the first two Saturdays worked in a calendar month as ordinary', () => {
  const shifts = [
    record('sat1', '2026-09-05', '08:00', '13:00'),
    record('sat2', '2026-09-12', '08:00', '13:00'),
    record('sat3', '2026-09-19', '08:00', '13:00'),
  ];
  const result = calculateAttendanceHours(shifts, schedules, []);
  assert.equal(result.get('sat1')?.ordinary, 4.5);
  assert.equal(result.get('sat2')?.ordinary, 4.5);
  assert.equal(result.get('sat3')?.overtime, 0);
  assert.equal(result.get('sat3')?.ordinary, 4.5, 'third Saturday fills unmet weekday hours before overtime');
});

test('third Saturday becomes overtime after that week\'s scheduled hours are complete', () => {
  const shifts = [record('sat1', '2026-09-05', '08:00', '13:00'), record('sat2', '2026-09-12', '08:00', '13:00')];
  for (const [index, date] of ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'].entries()) shifts.push(record(`weekday-${index}`, date, '07:30', '17:00'));
  shifts.push(record('sat3', '2026-09-19', '08:00', '13:00'));
  const result = calculateAttendanceHours(shifts, schedules, []);
  assert.deepEqual(result.get('sat3'), { worked: 4.5, ordinary: 0, overtime: 4.5, publicHoliday: 0 });
});

test('classifies public-holiday work separately as overtime hours', () => {
  const result = calculateAttendanceHours([record('holiday', '2026-09-24', '07:30', '17:00')], schedules, ['2026-09-24']).get('holiday');
  assert.deepEqual(result, { worked: 8.5, ordinary: 0, overtime: 0, publicHoliday: 8.5 });
});

test('does not double-deduct lunch when the employee clocks out for a full hour', () => {
  const shifts = [record('morning', '2026-09-07', '07:30', '12:00'), record('afternoon', '2026-09-07', '13:00', '17:00')];
  const result = calculateAttendanceHours(shifts, schedules, []);
  const total = [...result.values()].reduce((sum, item) => sum + item.worked, 0);
  assert.equal(total, 8.5);
});

test('daily status separates post-08:00 arrivals from staff with no clock-in', () => {
  const status = classifyDailyStatus(
    [{ id: 'on-time' }, { id: 'late' }, { id: 'absent' }, { id: 'leave' }],
    [{ staffId: 'on-time', clockInMinute: 7 * 60 + 45 }, { staffId: 'late', clockInMinute: 8 * 60 + 3 }],
    ['leave'],
  );
  assert.deepEqual(status.late.map((person) => person.id), ['late']);
  assert.deepEqual(status.absent.map((person) => person.id), ['absent']);
});
