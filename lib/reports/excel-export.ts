import ExcelJS from 'exceljs';
import type { DailyAttendanceRow, SummaryRow } from '@/lib/attendance/reporting';
import type { AttendanceReport } from '@/lib/reports/attendance-report';

const NAVY = '253044';
const LIGHT_GREEN = 'EAF5F1';
const RED = 'B42318';
const ORANGE = 'B54708';
const DURATION_FORMAT = '[h]:mm';

function excelDate(value: string) {
  return new Date(`${value}T12:00:00Z`);
}

function duration(minutes: number) {
  return minutes / 1440;
}

function timeValue(minutes: number | null) {
  if (minutes === null) return null;
  return (((minutes % 1440) + 1440) % 1440) / 1440;
}

function titleRows(sheet: ExcelJS.Worksheet, report: AttendanceReport, branchFilter: string, exportDate: Date) {
  sheet.addRow([report.organizationName]);
  sheet.addRow([`Reporting period: ${report.period.start} to ${report.period.end}`]);
  sheet.addRow([`Branch filter: ${branchFilter}`]);
  sheet.addRow([`Exported: ${exportDate.toLocaleString('en-ZA', { timeZone: report.timeZone })} (${report.timeZone})`]);
  sheet.addRow([]);
  sheet.getRow(1).font = { bold: true, size: 16, color: { argb: NAVY } };
  sheet.getRow(2).font = sheet.getRow(3).font = sheet.getRow(4).font = { size: 10, color: { argb: '667085' } };
}

function finishSheet(sheet: ExcelJS.Worksheet, headerRow: number, columnCount: number) {
  const header = sheet.getRow(headerRow);
  header.font = { bold: true, color: { argb: 'FFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 34;
  sheet.views = [{ state: 'frozen', ySplit: headerRow }];
  sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: Math.max(headerRow, sheet.rowCount), column: columnCount } };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > headerRow) row.alignment = { vertical: 'top' };
    row.eachCell((cell) => { cell.border = { bottom: { style: 'hair', color: { argb: 'D0D5DD' } } }; });
  });
}

function addSummaryRow(sheet: ExcelJS.Worksheet, label: string, branch: string, values: Pick<SummaryRow, 'daysLoggedInCount' | 'normalMinutes' | 'overtimeOneHalfMinutes' | 'overtimeDoubleMinutes' | 'totalOvertimeMinutes' | 'totalWorkedMinutes' | 'lateArrivalCount' | 'absenceCount' | 'incompleteRecordCount'>, style?: 'subtotal' | 'total') {
  const row = sheet.addRow([branch, label, values.daysLoggedInCount, duration(values.normalMinutes), duration(values.overtimeOneHalfMinutes), duration(values.overtimeDoubleMinutes), duration(values.totalOvertimeMinutes), duration(values.totalWorkedMinutes), values.lateArrivalCount, values.absenceCount, values.incompleteRecordCount]);
  row.getCell(3).numFmt = '0';
  for (let column = 4; column <= 8; column += 1) row.getCell(column).numFmt = DURATION_FORMAT;
  if (style) {
    row.font = { bold: true, color: style === 'total' ? { argb: 'FFFFFF' } : { argb: NAVY } };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style === 'total' ? NAVY : LIGHT_GREEN } };
  }
}

function addDailyRow(sheet: ExcelJS.Worksheet, row: DailyAttendanceRow) {
  const values = [excelDate(row.date), row.dayOfWeek, row.employeeName, row.branchName, timeValue(row.scheduledStartMinute), timeValue(row.actualClockInMinute), timeValue(row.scheduledFinishMinute), timeValue(row.actualClockOutMinute), duration(row.recordedBreakMinutes), duration(row.automaticBreakMinutes), duration(row.normalMinutes), duration(row.overtimeOneHalfMinutes), duration(row.overtimeDoubleMinutes), duration(row.totalOvertimeMinutes), duration(row.totalWorkedMinutes), row.lateMinutes, row.earlyDepartureMinutes, row.status, row.source === 'administrator_adjustment' ? 'Administrator adjustment' : row.source === 'employee_clocking' ? 'Employee clocking' : 'System', row.notes];
  const excelRow = sheet.addRow(values);
  excelRow.getCell(1).numFmt = 'yyyy-mm-dd';
  for (let column = 5; column <= 8; column += 1) excelRow.getCell(column).numFmt = 'hh:mm';
  for (let column = 9; column <= 15; column += 1) excelRow.getCell(column).numFmt = DURATION_FORMAT;
  if (row.flags.adjusted) excelRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4E5' } };
  if (row.flags.incomplete || row.flags.absent) excelRow.font = { color: { argb: RED } };
  else if (row.flags.late || row.flags.early || row.flags.overtime) excelRow.font = { color: { argb: ORANGE } };
}

export async function createAttendanceWorkbook(report: AttendanceReport) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Presently Attendance';
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  const branchFilter = report.options.branches.map((branch) => branch.name).join(', ') || 'None';

  const summary = workbook.addWorksheet('Summary');
  titleRows(summary, report, branchFilter, workbook.created);
  summary.addRow(['Branch', 'Employee name', 'Days logged in', 'Normal working hours', 'Overtime at 1.5×', 'Overtime at 2×', 'Total overtime', 'Total hours worked', 'Late-arrival count', 'Absence count', 'Incomplete-record count']);
  for (const branch of report.branchSubtotals) {
    for (const employee of report.summary.filter((row) => row.branchId === branch.branchId)) addSummaryRow(summary, employee.employeeName, branch.branchName, employee);
    addSummaryRow(summary, `${branch.branchName} subtotal`, branch.branchName, branch, 'subtotal');
  }
  addSummaryRow(summary, 'Company-wide total', 'All branches', report.companyTotal, 'total');
  summary.columns = [{ width: 22 }, { width: 30 }, { width: 15 }, ...Array.from({ length: 5 }, () => ({ width: 19 })), { width: 18 }, { width: 15 }, { width: 20 }];
  finishSheet(summary, 6, 11);

  const absence = workbook.addWorksheet('Absence & Leave');
  titleRows(absence, report, branchFilter, workbook.created);
  absence.addRow(['Days', 'Employee name', 'Leave reason', 'Branch', 'From date', 'To date', 'Notes']);
  for (const item of report.absenceAndLeave) {
    const row = absence.addRow([item.days, item.employeeName, item.reason, item.branchName, excelDate(item.fromDate), excelDate(item.toDate), item.notes]);
    row.getCell(1).numFmt = '0';
    row.getCell(5).numFmt = 'yyyy-mm-dd';
    row.getCell(6).numFmt = 'yyyy-mm-dd';
    if (item.unapprovedAbsence) row.font = { color: { argb: RED } };
  }
  absence.columns = [{ width: 10 }, { width: 30 }, { width: 30 }, { width: 22 }, { width: 13 }, { width: 13 }, { width: 42 }];
  finishSheet(absence, 6, 7);

  const daily = workbook.addWorksheet('Daily Attendance Detail');
  titleRows(daily, report, branchFilter, workbook.created);
  daily.addRow(['Date', 'Day', 'Employee', 'Branch', 'Scheduled start', 'Actual clock-in', 'Scheduled finish', 'Actual clock-out', 'Recorded break', 'Automatic break', 'Normal hours', 'Overtime 1.5×', 'Overtime 2×', 'Total overtime', 'Total worked', 'Late minutes', 'Early-departure minutes', 'Status', 'Record source', 'Notes / adjustment reason']);
  report.allDailyRows.forEach((row) => addDailyRow(daily, row));
  daily.columns = [{ width: 13 }, { width: 12 }, { width: 28 }, { width: 22 }, ...Array.from({ length: 4 }, () => ({ width: 16 })), ...Array.from({ length: 7 }, () => ({ width: 16 })), { width: 13 }, { width: 22 }, { width: 24 }, { width: 24 }, { width: 38 }];
  finishSheet(daily, 6, 20);

  const overtime = workbook.addWorksheet('Overtime Detail');
  titleRows(overtime, report, branchFilter, workbook.created);
  overtime.addRow(['Employee', 'Branch', 'Date', 'Day', 'Scheduled hours', 'Actual hours worked', 'Break deduction', 'Qualifying overtime', 'Rate', 'Reason / rule', 'Calculation source', 'Approval status']);
  for (const item of report.overtime) {
    const row = overtime.addRow([item.employeeName, item.branchName, excelDate(item.date), item.dayOfWeek, duration(item.scheduledMinutes), duration(item.actualMinutes), duration(item.breakDeductionMinutes), duration(item.qualifyingOvertimeMinutes), item.rate, item.reason, item.source, item.approvalStatus]);
    row.getCell(3).numFmt = 'yyyy-mm-dd';
    for (let column = 5; column <= 8; column += 1) row.getCell(column).numFmt = DURATION_FORMAT;
  }
  overtime.columns = [{ width: 28 }, { width: 22 }, { width: 13 }, { width: 12 }, ...Array.from({ length: 4 }, () => ({ width: 19 })), { width: 10 }, { width: 46 }, { width: 24 }, { width: 18 }];
  finishSheet(overtime, 6, 12);

  const patterns = workbook.addWorksheet('Attendance Patterns');
  titleRows(patterns, report, branchFilter, workbook.created);
  patterns.addRow(['Employee', 'Branch', 'Days scheduled', 'Days worked', 'Absences', 'Late arrivals', 'Total late minutes', 'Average clock-in', 'Early departures', 'Early-departure minutes', 'Missing clock-ins', 'Missing clock-outs', 'Incomplete records', 'Normal hours', 'Overtime 1.5×', 'Overtime 2×', 'Total overtime', 'Average daily hours', 'Manual adjustments', 'Common clock-in', 'Common clock-out']);
  for (const item of report.patterns) {
    const row = patterns.addRow([item.employeeName, item.branchName, item.totalDaysScheduled, item.totalDaysWorked, item.absenceCount, item.lateArrivalCount, item.totalLateMinutes, timeValue(item.averageClockInMinute), item.earlyDepartureCount, item.totalEarlyDepartureMinutes, item.missingClockInCount, item.missingClockOutCount, item.incompleteRecordCount, duration(item.normalMinutes), duration(item.overtimeOneHalfMinutes), duration(item.overtimeDoubleMinutes), duration(item.totalOvertimeMinutes), duration(item.averageDailyMinutes), item.manualAdjustmentCount, item.mostCommonClockInMinute === null ? null : timeValue(item.mostCommonClockInMinute), item.mostCommonClockOutMinute === null ? null : timeValue(item.mostCommonClockOutMinute)]);
    for (const column of [8, 20, 21]) row.getCell(column).numFmt = 'hh:mm';
    for (let column = 14; column <= 18; column += 1) row.getCell(column).numFmt = DURATION_FORMAT;
  }
  patterns.columns = [{ width: 28 }, { width: 22 }, ...Array.from({ length: 11 }, () => ({ width: 17 })), ...Array.from({ length: 5 }, () => ({ width: 18 })), { width: 19 }, { width: 17 }, { width: 17 }];
  finishSheet(patterns, 6, 21);

  const exceptions = workbook.addWorksheet('Exceptions & Incomplete Records');
  titleRows(exceptions, report, branchFilter, workbook.created);
  exceptions.addRow(['Date', 'Day', 'Employee', 'Branch', 'Scheduled start', 'Actual clock-in', 'Scheduled finish', 'Actual clock-out', 'Normal hours', 'Overtime 1.5×', 'Overtime 2×', 'Late minutes', 'Early-departure minutes', 'Status', 'Record source', 'Notes / adjustment reason']);
  for (const item of report.exceptions) {
    const row = exceptions.addRow([excelDate(item.date), item.dayOfWeek, item.employeeName, item.branchName, timeValue(item.scheduledStartMinute), timeValue(item.actualClockInMinute), timeValue(item.scheduledFinishMinute), timeValue(item.actualClockOutMinute), duration(item.normalMinutes), duration(item.overtimeOneHalfMinutes), duration(item.overtimeDoubleMinutes), item.lateMinutes, item.earlyDepartureMinutes, item.status, item.source, item.notes]);
    row.getCell(1).numFmt = 'yyyy-mm-dd';
    for (let column = 5; column <= 8; column += 1) row.getCell(column).numFmt = 'hh:mm';
    for (let column = 9; column <= 11; column += 1) row.getCell(column).numFmt = DURATION_FORMAT;
    if (item.flags.adjusted) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4E5' } };
  }
  exceptions.columns = [{ width: 13 }, { width: 12 }, { width: 28 }, { width: 22 }, ...Array.from({ length: 7 }, () => ({ width: 17 })), { width: 13 }, { width: 22 }, { width: 24 }, { width: 38 }];
  finishSheet(exceptions, 6, 16);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function exportFilename(report: AttendanceReport) {
  return `attendance-report-${report.period.start}-to-${report.period.end}.xlsx`;
}
