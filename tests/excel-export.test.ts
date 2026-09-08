import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createAttendanceWorkbook } from '../lib/reports/excel-export.ts';

test('creates five filtered worksheets with Excel durations above 24 hours', async () => {
  const summary = { employeeId: 'employee', employeeName: 'Employee One', branchId: 'branch', branchName: 'Branch One', normalMinutes: 3000, overtimeOneHalfMinutes: 120, overtimeDoubleMinutes: 60, totalOvertimeMinutes: 180, totalWorkedMinutes: 3180, lateArrivalCount: 1, absenceCount: 0, incompleteRecordCount: 0 };
  const report = {
    organizationName: 'Pits Paints', timeZone: 'Africa/Johannesburg', role: 'admin' as const,
    period: { preset: 'current_month', start: '2026-09-01', end: '2026-09-07', today: '2026-09-08', includesToday: false }, filters: {},
    options: { branches: [{ id: 'branch', name: 'Branch One' }], employees: [{ id: 'employee', name: 'Employee One', branchId: 'branch' }], departments: [] },
    daily: [], dailyTotal: 0, page: 1, pageSize: 50, pageCount: 1,
    summary: [summary], branchSubtotals: [{ branchId: 'branch', branchName: 'Branch One', normalMinutes: 3000, overtimeOneHalfMinutes: 120, overtimeDoubleMinutes: 60, totalOvertimeMinutes: 180, totalWorkedMinutes: 3180, lateArrivalCount: 1, absenceCount: 0, incompleteRecordCount: 0 }],
    companyTotal: { normalMinutes: 3000, overtimeOneHalfMinutes: 120, overtimeDoubleMinutes: 60, totalOvertimeMinutes: 180, totalWorkedMinutes: 3180, lateArrivalCount: 1, absenceCount: 0, incompleteRecordCount: 0 }, overtime: [], patterns: [], trends: [], exceptions: [], allDailyRows: [],
  };
  const buffer = await createAttendanceWorkbook(report);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Summary', 'Daily Attendance Detail', 'Overtime Detail', 'Attendance Patterns', 'Exceptions & Incomplete Records']);
  const sheet = workbook.getWorksheet('Summary')!;
  assert.equal(sheet.views[0].ySplit, 6);
  assert.ok(sheet.autoFilter);
  assert.equal(sheet.getCell('C7').numFmt, '[h]:mm');
  assert.ok(sheet.getCell('C7').value instanceof Date);
  assert.equal((sheet.getCell('C7').value as Date).toISOString(), '1900-01-01T02:00:00.000Z');
});
