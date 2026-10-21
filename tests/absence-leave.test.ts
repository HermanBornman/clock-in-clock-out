import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAbsenceAndLeaveRows } from '../lib/reports/absence-leave.ts';
import type { DailyAttendanceRow, ReportingEmployee, ReportingLeave } from '../lib/attendance/reporting.ts';

const employee: ReportingEmployee = { id: 'staff', name: 'Employee One', branchId: 'branch', branchName: 'Branch One', active: true };
const leave: ReportingLeave = { id: 'leave', staffId: 'staff', branchId: 'branch', branchName: 'Branch One', startDate: '2026-09-01', endDate: '2026-09-05', type: 'family_responsibility', reason: 'Family emergency', status: 'approved' };

function absence(date: string): DailyAttendanceRow {
  return {
    id: `absence-${date}`, attendanceRecordId: null, attendanceRecords: [], employeeId: 'staff', employeeName: 'Employee One', branchId: 'branch', branchName: 'Branch One', department: null,
    date, dayOfWeek: 'Monday', scheduledStartMinute: 450, actualClockInMinute: null, scheduledFinishMinute: 1020, actualClockOutMinute: null,
    recordedBreakMinutes: 0, automaticBreakMinutes: 0, normalMinutes: 0, overtimeOneHalfMinutes: 0, overtimeDoubleMinutes: 0, totalOvertimeMinutes: 0, totalWorkedMinutes: 0,
    lateMinutes: 0, earlyDepartureMinutes: 0, status: 'Absent', source: 'system', notes: '', scheduledMinutes: 510, scheduledDay: true, qualifyingOvertimeMinutes: 0,
    overtimeReason: null, overtimeApprovalStatus: null,
    flags: { late: false, early: false, missingClockIn: false, missingClockOut: false, absent: true, incomplete: false, adjusted: false, overtime: false },
  };
}

test('groups leave periods and consecutive unapproved absences for the report range', () => {
  const rows = buildAbsenceAndLeaveRows({ dailyRows: [absence('2026-09-06'), absence('2026-09-07')], leave: [leave], employees: [employee], reportStart: '2026-09-03', reportEnd: '2026-09-07' });
  assert.deepEqual(rows.map((row) => ({ days: row.days, reason: row.reason, from: row.fromDate, to: row.toDate, notes: row.notes })), [
    { days: 2.5, reason: 'Family responsibility leave', from: '2026-09-03', to: '2026-09-05', notes: 'Family emergency' },
    { days: 2, reason: 'Absent (no approved leave)', from: '2026-09-06', to: '2026-09-07', notes: '' },
  ]);
});

test('counts weekdays as full leave days, Saturdays as half days, and Sundays as zero', () => {
  const weeklyLeave: ReportingLeave = { ...leave, startDate: '2026-10-19', endDate: '2026-10-25', type: 'annual' };
  const rows = buildAbsenceAndLeaveRows({ dailyRows: [], leave: [weeklyLeave], employees: [employee], reportStart: '2026-10-19', reportEnd: '2026-10-25' });
  assert.equal(rows[0].days, 5.5);
});
