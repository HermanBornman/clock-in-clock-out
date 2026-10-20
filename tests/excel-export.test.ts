import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createAttendanceWorkbook } from '../lib/reports/excel-export.ts';

test('creates six filtered worksheets including absence reasons and Excel durations above 24 hours', async () => {
  const summary = { employeeId: 'employee', employeeName: 'Employee One', branchId: 'branch', branchName: 'Branch One', daysLoggedInCount: 5, normalMinutes: 3000, overtimeOneHalfMinutes: 120, overtimeDoubleMinutes: 60, totalOvertimeMinutes: 180, totalWorkedMinutes: 3180, lateArrivalCount: 1, absenceCount: 0, incompleteRecordCount: 0 };
  const dailyRow = (date: string, status: 'Absent' | 'Annual leave' | 'Sick leave') => ({
    id: `${status}-${date}`, attendanceRecordId: null, attendanceRecords: [], employeeId: 'employee', employeeName: 'Employee One', branchId: 'branch', branchName: 'Branch One', department: null,
    date, dayOfWeek: 'Monday', scheduledStartMinute: 450, actualClockInMinute: null, scheduledFinishMinute: 1020, actualClockOutMinute: null,
    recordedBreakMinutes: 0, automaticBreakMinutes: 0, normalMinutes: 0, overtimeOneHalfMinutes: 0, overtimeDoubleMinutes: 0, totalOvertimeMinutes: 0, totalWorkedMinutes: 0,
    lateMinutes: 0, earlyDepartureMinutes: 0, status, source: 'system' as const, notes: '', scheduledMinutes: 510, scheduledDay: true, qualifyingOvertimeMinutes: 0,
    overtimeReason: null, overtimeApprovalStatus: null,
    flags: { late: false, early: false, missingClockIn: status === 'Absent', missingClockOut: false, absent: status === 'Absent', incomplete: status === 'Absent', adjusted: false, overtime: false },
  });
  const absenceRows = [dailyRow('2026-09-01', 'Absent'), dailyRow('2026-09-02', 'Annual leave'), dailyRow('2026-09-03', 'Sick leave')];
  const report = {
    organizationName: 'Pits Paints', timeZone: 'Africa/Johannesburg', role: 'admin' as const,
    period: { preset: 'current_month', start: '2026-09-01', end: '2026-09-07', today: '2026-09-08', includesToday: false }, filters: {},
    options: { branches: [{ id: 'branch', name: 'Branch One' }], employees: [{ id: 'employee', name: 'Employee One', branchId: 'branch' }], departments: [] },
    daily: [], dailyTotal: 0, page: 1, pageSize: 50, pageCount: 1,
    summary: [summary], branchSubtotals: [{ branchId: 'branch', branchName: 'Branch One', daysLoggedInCount: 5, normalMinutes: 3000, overtimeOneHalfMinutes: 120, overtimeDoubleMinutes: 60, totalOvertimeMinutes: 180, totalWorkedMinutes: 3180, lateArrivalCount: 1, absenceCount: 0, incompleteRecordCount: 0 }],
    companyTotal: { daysLoggedInCount: 5, normalMinutes: 3000, overtimeOneHalfMinutes: 120, overtimeDoubleMinutes: 60, totalOvertimeMinutes: 180, totalWorkedMinutes: 3180, lateArrivalCount: 1, absenceCount: 0, incompleteRecordCount: 0 }, overtime: [], patterns: [], trends: [], exceptions: absenceRows, allDailyRows: absenceRows,
  };
  const buffer = await createAttendanceWorkbook(report);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Summary', 'Absence & Leave', 'Daily Attendance Detail', 'Overtime Detail', 'Attendance Patterns', 'Exceptions & Incomplete Records']);
  const sheet = workbook.getWorksheet('Summary')!;
  assert.equal(sheet.views[0].ySplit, 6);
  assert.ok(sheet.autoFilter);
  assert.equal(sheet.getCell('C6').value, 'Days logged in');
  assert.equal(sheet.getCell('C7').value, 5);
  assert.equal(sheet.getCell('C7').numFmt, '0');
  assert.equal(sheet.getCell('C8').value, 5);
  assert.equal(sheet.getCell('C9').value, 5);
  assert.equal(sheet.autoFilter, 'A6:K9');
  assert.equal(sheet.getCell('D7').numFmt, '[h]:mm');
  assert.ok(sheet.getCell('D7').value instanceof Date);
  assert.equal((sheet.getCell('D7').value as Date).toISOString(), '1900-01-01T02:00:00.000Z');

  const absenceSheet = workbook.getWorksheet('Absence & Leave')!;
  assert.equal(absenceSheet.getCell('E6').value, 'Reason');
  assert.deepEqual(['E7', 'E8', 'E9'].map((cell) => absenceSheet.getCell(cell).value), ['Absent (no approved leave)', 'Annual leave', 'Sick leave']);
  assert.deepEqual(['A7', 'A8', 'A9'].map((cell) => (absenceSheet.getCell(cell).value as Date).toISOString().slice(0, 10)), ['2026-09-01', '2026-09-02', '2026-09-03']);
  assert.equal(absenceSheet.autoFilter, 'A6:F9');
});
