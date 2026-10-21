import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createAttendanceWorkbook, exportFilename } from '../lib/reports/excel-export.ts';

test('creates a two-sheet payroll report with leave and weekly overtime totals', async () => {
  const summary = [
    { employeeId: 'employee-1', employeeName: 'Employee One', branchId: 'branch', branchName: 'Branch One', daysLoggedInCount: 5, normalMinutes: 3000, overtimeOneHalfMinutes: 150, overtimeDoubleMinutes: 60, totalOvertimeMinutes: 210, totalWorkedMinutes: 3210, lateArrivalCount: 1, absenceCount: 0, incompleteRecordCount: 0 },
    { employeeId: 'employee-2', employeeName: 'Employee Two', branchId: 'branch', branchName: 'Branch One', daysLoggedInCount: 0, normalMinutes: 0, overtimeOneHalfMinutes: 0, overtimeDoubleMinutes: 0, totalOvertimeMinutes: 0, totalWorkedMinutes: 0, lateArrivalCount: 0, absenceCount: 0, incompleteRecordCount: 0 },
    { employeeId: 'employee-3', employeeName: 'Employee Three', branchId: 'branch', branchName: 'Branch One', daysLoggedInCount: 0, normalMinutes: 0, overtimeOneHalfMinutes: 0, overtimeDoubleMinutes: 0, totalOvertimeMinutes: 0, totalWorkedMinutes: 0, lateArrivalCount: 0, absenceCount: 1, incompleteRecordCount: 1 },
  ];
  const totals = { daysLoggedInCount: 5, normalMinutes: 3000, overtimeOneHalfMinutes: 150, overtimeDoubleMinutes: 60, totalOvertimeMinutes: 210, totalWorkedMinutes: 3210, lateArrivalCount: 1, absenceCount: 1, incompleteRecordCount: 1 };
  const report = {
    organizationName: 'Pits Paints', timeZone: 'Africa/Johannesburg', role: 'admin' as const,
    period: { preset: 'payroll_period', start: '2026-08-26', end: '2026-09-07', today: '2026-09-08', includesToday: false }, filters: {},
    options: { branches: [{ id: 'branch', name: 'Branch One' }], employees: summary.map((row) => ({ id: row.employeeId, name: row.employeeName, branchId: row.branchId })), departments: [] },
    daily: [], dailyTotal: 0, page: 1, pageSize: 50, pageCount: 1,
    summary,
    branchSubtotals: [{ branchId: 'branch', branchName: 'Branch One', ...totals }],
    companyTotal: totals,
    overtime: [
      { id: 'ot-1', employeeId: 'employee-1', employeeName: 'Employee One', branchId: 'branch', branchName: 'Branch One', date: '2026-09-01', dayOfWeek: 'Tuesday', scheduledMinutes: 510, actualMinutes: 570, breakDeductionMinutes: 60, qualifyingOvertimeMinutes: 60, rate: '1.5×' as const, reason: 'Weekday overtime', source: 'Automatically calculated' as const, approvalStatus: 'Confirmed' },
      { id: 'ot-2', employeeId: 'employee-1', employeeName: 'Employee One', branchId: 'branch', branchName: 'Branch One', date: '2026-09-03', dayOfWeek: 'Thursday', scheduledMinutes: 510, actualMinutes: 570, breakDeductionMinutes: 60, qualifyingOvertimeMinutes: 60, rate: '2×' as const, reason: 'Public holiday', source: 'Automatically calculated' as const, approvalStatus: 'Confirmed' },
      { id: 'ot-3', employeeId: 'employee-1', employeeName: 'Employee One', branchId: 'branch', branchName: 'Branch One', date: '2026-09-07', dayOfWeek: 'Monday', scheduledMinutes: 510, actualMinutes: 600, breakDeductionMinutes: 60, qualifyingOvertimeMinutes: 90, rate: '1.5×' as const, reason: 'Weekday overtime', source: 'Automatically calculated' as const, approvalStatus: 'Confirmed' },
    ],
    patterns: [], trends: [], exceptions: [], allDailyRows: [],
    absenceAndLeave: [
      { id: 'leave-1', days: 3, employeeName: 'Employee One', reason: 'Annual leave', branchName: 'Branch One', fromDate: '2026-09-01', toDate: '2026-09-03', notes: 'Family holiday', unapprovedAbsence: false },
      { id: 'leave-2', days: 1, employeeName: 'Employee Two', reason: 'Family responsibility leave', branchName: 'Branch One', fromDate: '2026-09-04', toDate: '2026-09-04', notes: 'Family emergency', unapprovedAbsence: false },
      { id: 'absence-1', days: 1, employeeName: 'Employee Three', reason: 'Absent (no approved leave)', branchName: 'Branch One', fromDate: '2026-09-05', toDate: '2026-09-05', notes: '', unapprovedAbsence: true },
    ],
  };

  const buffer = await createAttendanceWorkbook(report);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Payroll Summary', 'Weekly Overtime']);
  assert.equal(exportFilename(report), 'payroll-report-2026-08-26-to-2026-09-07.xlsx');

  const payroll = workbook.getWorksheet('Payroll Summary')!;
  assert.deepEqual(['A6', 'B6', 'C6', 'D6', 'E6', 'F6', 'G6'].map((cell) => payroll.getCell(cell).value), ['Branch', 'Employee name', 'Days worked', 'Overtime 1.5×', 'Overtime 2× (public holidays)', 'Leave days', 'Leave type(s)']);
  assert.deepEqual(['B7', 'C7', 'F7', 'G7'].map((cell) => payroll.getCell(cell).value), ['Employee One', 5, 3, 'Annual leave: 3 days']);
  assert.deepEqual(['B8', 'F8', 'G8'].map((cell) => payroll.getCell(cell).value), ['Employee Two', 1, 'Family responsibility leave: 1 day']);
  assert.deepEqual(['B9', 'F9', 'G9'].map((cell) => payroll.getCell(cell).value), ['Employee Three', 0, 'None']);
  assert.deepEqual(['C11', 'F11'].map((cell) => payroll.getCell(cell).value), [5, 4]);
  assert.equal(payroll.getCell('D7').numFmt, '[h]:mm');
  assert.equal(payroll.getCell('E7').numFmt, '[h]:mm');
  assert.ok(payroll.getCell('D7').value instanceof Date);
  assert.equal((payroll.getCell('D7').value as Date).toISOString(), '1899-12-30T02:30:00.000Z');
  assert.equal((payroll.getCell('E7').value as Date).toISOString(), '1899-12-30T01:00:00.000Z');
  assert.equal(payroll.autoFilter, 'A6:G11');

  const overtime = workbook.getWorksheet('Weekly Overtime')!;
  assert.deepEqual(['A6', 'B6', 'C6', 'D6', 'E6', 'F6', 'G6', 'H6'].map((cell) => overtime.getCell(cell).value), ['Employee', 'Branch', 'Week starting', 'Week ending', 'Overtime date', 'Day', 'Rate', 'Overtime hours']);
  assert.equal(overtime.getCell('G9').value, 'Weekly total');
  assert.equal((overtime.getCell('H9').value as Date).toISOString(), '1899-12-30T02:00:00.000Z');
  assert.equal(overtime.getCell('G11').value, 'Weekly total');
  assert.equal((overtime.getCell('H11').value as Date).toISOString(), '1899-12-30T01:30:00.000Z');
  assert.equal(overtime.autoFilter, 'A6:H11');
});
