import ExcelJS from 'exceljs';
import { addDays, weekStart, type SummaryRow } from '../attendance/reporting.ts';
import type { AttendanceReport } from '@/lib/reports/attendance-report';

const NAVY = '253044';
const LIGHT_GREEN = 'EAF5F1';
const DURATION_FORMAT = '[h]:mm';

function excelDate(value: string) {
  return new Date(`${value}T12:00:00Z`);
}

function duration(minutes: number) {
  return minutes / 1440;
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

type LeaveSummary = { days: number; types: Map<string, number> };

function payrollKey(employeeName: string, branchName: string) {
  return `${branchName}\u0000${employeeName}`;
}

function addLeave(summary: LeaveSummary, reason: string, days: number) {
  summary.days += days;
  summary.types.set(reason, (summary.types.get(reason) ?? 0) + days);
}

function leaveLabel(summary: LeaveSummary) {
  if (!summary.days) return 'None';
  return [...summary.types]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, days]) => `${reason}: ${days.toLocaleString('en-ZA', { maximumFractionDigits: 2 })} day${days === 1 ? '' : 's'}`)
    .join('; ');
}

function addPayrollRow(sheet: ExcelJS.Worksheet, branch: string, label: string, values: Pick<SummaryRow, 'daysLoggedInCount' | 'totalOvertimeMinutes'>, leave: LeaveSummary, style?: 'subtotal' | 'total') {
  const row = sheet.addRow([branch, label, values.daysLoggedInCount, duration(values.totalOvertimeMinutes), leave.days, leaveLabel(leave)]);
  row.getCell(3).numFmt = '0';
  row.getCell(4).numFmt = DURATION_FORMAT;
  row.getCell(5).numFmt = '0.##';
  if (style) {
    row.font = { bold: true, color: style === 'total' ? { argb: 'FFFFFF' } : { argb: NAVY } };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style === 'total' ? NAVY : LIGHT_GREEN } };
  }
}

export async function createAttendanceWorkbook(report: AttendanceReport) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Presently Attendance';
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  const branchFilter = report.options.branches.map((branch) => branch.name).join(', ') || 'None';

  const leaveByEmployee = new Map<string, LeaveSummary>();
  const companyLeave: LeaveSummary = { days: 0, types: new Map() };
  for (const item of report.absenceAndLeave.filter((row) => !row.unapprovedAbsence)) {
    const key = payrollKey(item.employeeName, item.branchName);
    const employeeLeave = leaveByEmployee.get(key) ?? { days: 0, types: new Map() };
    addLeave(employeeLeave, item.reason, item.days);
    addLeave(companyLeave, item.reason, item.days);
    leaveByEmployee.set(key, employeeLeave);
  }

  const summary = workbook.addWorksheet('Payroll Summary');
  titleRows(summary, report, branchFilter, workbook.created);
  summary.addRow(['Branch', 'Employee name', 'Days worked', 'Overtime hours', 'Leave days', 'Leave type(s)']);
  for (const branch of report.branchSubtotals) {
    const employees = report.summary.filter((row) => row.branchId === branch.branchId);
    const branchLeave: LeaveSummary = { days: 0, types: new Map() };
    for (const employee of employees) {
      const employeeLeave = leaveByEmployee.get(payrollKey(employee.employeeName, branch.branchName)) ?? { days: 0, types: new Map() };
      addPayrollRow(summary, branch.branchName, employee.employeeName, employee, employeeLeave);
      for (const [reason, days] of employeeLeave.types) addLeave(branchLeave, reason, days);
    }
    addPayrollRow(summary, branch.branchName, `${branch.branchName} subtotal`, branch, branchLeave, 'subtotal');
  }
  addPayrollRow(summary, 'All branches', 'Company-wide total', report.companyTotal, companyLeave, 'total');
  summary.columns = [{ width: 22 }, { width: 30 }, { width: 14 }, { width: 18 }, { width: 14 }, { width: 46 }];
  finishSheet(summary, 6, 6);

  const overtime = workbook.addWorksheet('Weekly Overtime');
  titleRows(overtime, report, branchFilter, workbook.created);
  overtime.addRow(['Employee', 'Branch', 'Week starting', 'Week ending', 'Overtime date', 'Day', 'Rate', 'Overtime hours']);
  const overtimeGroups = new Map<string, typeof report.overtime>();
  for (const item of [...report.overtime].sort((left, right) => `${left.branchName}|${left.employeeName}|${left.date}|${left.rate}`.localeCompare(`${right.branchName}|${right.employeeName}|${right.date}|${right.rate}`))) {
    const monday = weekStart(item.date);
    const key = `${item.employeeId}|${monday}`;
    overtimeGroups.set(key, [...(overtimeGroups.get(key) ?? []), item]);
  }
  for (const items of overtimeGroups.values()) {
    const monday = weekStart(items[0].date);
    const sunday = addDays(monday, 6);
    let weeklyMinutes = 0;
    for (const item of items) {
      weeklyMinutes += item.qualifyingOvertimeMinutes;
      const row = overtime.addRow([item.employeeName, item.branchName, excelDate(monday), excelDate(sunday), excelDate(item.date), item.dayOfWeek, item.rate, duration(item.qualifyingOvertimeMinutes)]);
      for (const column of [3, 4, 5]) row.getCell(column).numFmt = 'yyyy-mm-dd';
      row.getCell(8).numFmt = DURATION_FORMAT;
    }
    const total = overtime.addRow([items[0].employeeName, items[0].branchName, excelDate(monday), excelDate(sunday), null, null, 'Weekly total', duration(weeklyMinutes)]);
    for (const column of [3, 4]) total.getCell(column).numFmt = 'yyyy-mm-dd';
    total.getCell(8).numFmt = DURATION_FORMAT;
    total.font = { bold: true, color: { argb: NAVY } };
    total.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_GREEN } };
  }
  overtime.columns = [{ width: 30 }, { width: 22 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 13 }, { width: 16 }, { width: 18 }];
  finishSheet(overtime, 6, 8);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function exportFilename(report: AttendanceReport) {
  return `payroll-report-${report.period.start}-to-${report.period.end}.xlsx`;
}
