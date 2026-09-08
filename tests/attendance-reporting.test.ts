import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAttendanceReport, resolveReportPeriod, type ReportingEmployee, type ReportingRecord, type ReportingSchedule } from '../lib/attendance/reporting.ts';

const schedules: ReportingSchedule[] = [
  ...[1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, opensAtMinute: 450, closesAtMinute: 1020, unpaidBreakMinutes: 60 })),
  { dayOfWeek: 6, opensAtMinute: 480, closesAtMinute: 780, unpaidBreakMinutes: 30 },
  { dayOfWeek: 7, opensAtMinute: null, closesAtMinute: null, unpaidBreakMinutes: 0 },
];
const employee: ReportingEmployee = { id: 'staff', name: 'Test Employee', branchId: 'branch', branchName: 'Test Branch', active: true, employmentStartDate: '2026-09-01' };
const shift = (id: string, date: string, clockInMinute: number | null, clockOutMinute: number | null, source: ReportingRecord['source'] = 'employee_clocking'): ReportingRecord => ({ id, staffId: 'staff', branchId: 'branch', date, clockInMinute, clockOutMinute, source, adjustmentReason: source === 'administrator_adjustment' ? 'Manager verified the times' : null });

function report(records: ReportingRecord[], start = '2026-09-07', end = '2026-09-13', holidays: string[] = []) {
  return calculateAttendanceReport({ employees: [employee], records, schedules, publicHolidayDates: holidays, leave: [], reportStart: start, reportEnd: end, today: '2026-09-14' });
}

test('resolves completed period presets and excludes today from custom ranges', () => {
  const reference = new Date('2026-09-08T06:00:00Z');
  assert.deepEqual(resolveReportPeriod('yesterday', reference), { preset: 'yesterday', start: '2026-09-07', end: '2026-09-07', today: '2026-09-08', includesToday: false });
  assert.equal(resolveReportPeriod('custom', reference, '2026-09-01', '2026-09-08').end, '2026-09-07');
  assert.equal(resolveReportPeriod('payroll_period', reference).start, '2026-08-25');
});

test('creates complete, late, early, missing and absent daily statuses', () => {
  const result = report([
    shift('mon', '2026-09-07', 450, 1020),
    shift('tue', '2026-09-08', 480, 1020),
    shift('wed', '2026-09-09', 450, 960),
    shift('thu', '2026-09-10', 450, null),
    shift('fri', '2026-09-11', null, 1020),
  ]);
  assert.equal(result.daily.find((row) => row.date === '2026-09-07')?.status, 'Complete');
  assert.equal(result.daily.find((row) => row.date === '2026-09-08')?.status, 'Late');
  assert.equal(result.daily.find((row) => row.date === '2026-09-09')?.status, 'Early departure');
  assert.equal(result.daily.find((row) => row.date === '2026-09-10')?.status, 'Missing clock-out');
  assert.equal(result.daily.find((row) => row.date === '2026-09-11')?.status, 'Missing clock-in');
});

test('deducts recorded and automatic breaks without double counting', () => {
  const result = report([shift('am', '2026-09-07', 450, 720), shift('pm', '2026-09-07', 780, 1020)], '2026-09-07', '2026-09-07');
  const row = result.daily[0];
  assert.equal(row.recordedBreakMinutes, 60);
  assert.equal(row.automaticBreakMinutes, 0);
  assert.equal(row.normalMinutes, 510);
});

test('merges duplicates and does not confirm overtime from incomplete records', () => {
  const result = report([shift('one', '2026-09-07', 450, 1050), shift('duplicate', '2026-09-07', 450, 1050), shift('missing', '2026-09-07', 1100, null)], '2026-09-07', '2026-09-07');
  assert.equal(result.daily[0].totalWorkedMinutes, 510);
  assert.equal(result.daily[0].totalOvertimeMinutes, 0);
  assert.equal(result.daily[0].status, 'Missing clock-out');
});

test('classifies the third Saturday at 1.5 times and Sunday or holidays at 2 times', () => {
  const records = [
    shift('sat1', '2026-09-05', 480, 780), shift('sat2', '2026-09-12', 480, 780),
    ...['2026-09-14','2026-09-15','2026-09-16','2026-09-17','2026-09-18'].map((date, index) => shift(`weekday-${index}`, date, 450, 1020)),
    shift('sat3', '2026-09-19', 480, 780), shift('sun', '2026-09-20', 480, 600), shift('holiday', '2026-09-24', 450, 1020),
  ];
  const result = report(records, '2026-09-05', '2026-09-24', ['2026-09-24']);
  assert.equal(result.daily.find((row) => row.date === '2026-09-19')?.overtimeOneHalfMinutes, 270);
  assert.equal(result.daily.find((row) => row.date === '2026-09-20')?.overtimeDoubleMinutes, 120);
  assert.equal(result.daily.find((row) => row.date === '2026-09-24')?.overtimeDoubleMinutes, 510);
});

test('handles an overnight clock-out without negative or truncated time', () => {
  const records = [shift('overnight', '2026-09-07', 450, 1530), ...['2026-09-08','2026-09-09','2026-09-10','2026-09-11'].map((date, index) => shift(`day-${index}`, date, 450, 1020))];
  const result = report(records, '2026-09-07', '2026-09-11');
  assert.equal(result.daily.find((row) => row.date === '2026-09-07')?.totalWorkedMinutes, 990);
  assert.equal(result.daily.find((row) => row.date === '2026-09-07')?.overtimeOneHalfMinutes, 480);
});

test('counts manual adjustments and keeps their reason and source', () => {
  const result = report([shift('adjusted', '2026-09-07', 450, 1020, 'administrator_adjustment')], '2026-09-07', '2026-09-07');
  assert.equal(result.patterns[0].manualAdjustmentCount, 1);
  assert.equal(result.daily[0].notes, 'Manager verified the times');
  assert.equal(result.daily[0].source, 'administrator_adjustment');
});

test('combines branch, overtime and exception filters', () => {
  const records = [shift('late-ot', '2026-09-07', 480, 1140), ...['2026-09-08','2026-09-09','2026-09-10','2026-09-11'].map((date, index) => shift(`full-${index}`, date, 450, 1020))];
  const result = calculateAttendanceReport({ employees: [employee], records, schedules, publicHolidayDates: [], leave: [], reportStart: '2026-09-07', reportEnd: '2026-09-11', today: '2026-09-12', filters: { branchIds: ['branch'], late: true, hasOvertime: true, search: 'test' } });
  assert.equal(result.daily.length, 1);
  assert.equal(result.daily[0].lateMinutes, 30);
});
