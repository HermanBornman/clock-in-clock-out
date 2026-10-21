import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateConsolidatedMinutes, formatMinutes, managementReportPeriod, type ConsolidatedAttendanceInput } from '../lib/attendance/consolidated.ts';
import type { WorkScheduleInput } from '../lib/attendance/calculation.ts';

const schedules: WorkScheduleInput[] = [
  ...[1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, opensAtMinute: 450, closesAtMinute: 1020, unpaidBreakMinutes: 60 })),
  { dayOfWeek: 6, opensAtMinute: 480, closesAtMinute: 780, unpaidBreakMinutes: 30 },
  { dayOfWeek: 7, opensAtMinute: null, closesAtMinute: null, unpaidBreakMinutes: 0 },
];

function shift(id: string, date: string, start: number, end: number, staffId = 'staff'): ConsolidatedAttendanceInput {
  return { id, staffId, date, clockInMinute: start, clockOutMinute: end };
}

test('uses the 25th of the previous month through the previous Johannesburg day', () => {
  assert.deepEqual(managementReportPeriod(new Date('2026-09-08T04:30:00Z')), { reportDate: '2026-09-07', periodStart: '2026-08-25', periodEnd: '2026-09-07' });
  assert.deepEqual(managementReportPeriod(new Date('2027-01-01T06:00:00Z')), { reportDate: '2026-12-31', periodStart: '2026-11-25', periodEnd: '2026-12-31' });
});

test('keeps minute precision, clamps early clock-ins and deducts a missing weekday lunch', () => {
  const totals = calculateConsolidatedMinutes([shift('mon', '2026-09-07', 405, 1020)], schedules, [], '2026-09-07', '2026-09-07').get('staff');
  assert.equal(totals?.normalMinutes, 510);
  assert.equal(formatMinutes(totals?.normalMinutes ?? 0), '8h 30m');
});

test('does not double deduct a recorded weekday lunch', () => {
  const totals = calculateConsolidatedMinutes([
    shift('am', '2026-09-07', 450, 720),
    shift('pm', '2026-09-07', 780, 1020),
  ], schedules, [], '2026-09-07', '2026-09-07').get('staff');
  assert.equal(totals?.normalMinutes, 510);
});

test('deducts a 30-minute Saturday break and ranks the first two Saturdays per month', () => {
  const records = [
    shift('sat1', '2026-09-05', 480, 780),
    shift('sat2', '2026-09-12', 480, 780),
    ...['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'].map((date, index) => shift(`weekday-${index}`, date, 450, 1020)),
    shift('sat3', '2026-09-19', 480, 780),
  ];
  const totals = calculateConsolidatedMinutes(records, schedules, [], '2026-09-05', '2026-09-19').get('staff');
  assert.equal(totals?.normalMinutes, 3090);
  assert.equal(totals?.overtimeOneHalfMinutes, 270);
});

test('classifies Sundays at 1.5 times and only public holidays at double time', () => {
  const records = [shift('sun', '2026-09-06', 450, 570), shift('holiday', '2026-09-24', 450, 1020)];
  const totals = calculateConsolidatedMinutes(records, schedules, ['2026-09-24'], '2026-09-01', '2026-09-30').get('staff');
  assert.equal(totals?.overtimeDoubleMinutes, 510);
  assert.equal(totals?.overtimeOneHalfMinutes, 120);
});

test('merges duplicate and overlapping completed records', () => {
  const totals = calculateConsolidatedMinutes([
    shift('original', '2026-09-07', 450, 1020),
    shift('duplicate', '2026-09-07', 450, 1020),
    shift('overlap', '2026-09-07', 600, 900),
  ], schedules, [], '2026-09-07', '2026-09-07').get('staff');
  assert.equal(totals?.normalMinutes, 510);
});

test('drops remaining overtime below an hour after completing weekly normal hours', () => {
  const records = [
    shift('mon', '2026-09-07', 510, 1020),
    ...['2026-09-08', '2026-09-09', '2026-09-10'].map((date, index) => shift(`day-${index}`, date, 450, 1020)),
    shift('fri', '2026-09-11', 450, 1140),
  ];
  const totals = calculateConsolidatedMinutes(records, schedules, [], '2026-09-07', '2026-09-11').get('staff');
  assert.equal(totals?.normalMinutes, 2550);
  assert.equal(totals?.overtimeOneHalfMinutes, 0);
});

test('rounds qualifying consolidated overtime down to 30-minute blocks', () => {
  const records = [
    ...['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'].map((date, index) => shift(`day-${index}`, date, 450, 1020)),
    shift('fri', '2026-09-11', 450, 1139),
  ];
  const totals = calculateConsolidatedMinutes(records, schedules, [], '2026-09-07', '2026-09-11').get('staff');
  assert.equal(totals?.overtimeOneHalfMinutes, 60);
});
