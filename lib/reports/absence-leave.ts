import { addDays, type DailyAttendanceRow, type ReportingEmployee, type ReportingLeave } from '../attendance/reporting.ts';
import { leaveTypeLabel } from '../leave/types.ts';

export type AbsenceAndLeaveRow = {
  id: string;
  days: number;
  employeeName: string;
  reason: string;
  branchName: string;
  fromDate: string;
  toDate: string;
  notes: string;
  unapprovedAbsence: boolean;
};

function calendarDays(fromDate: string, toDate: string) {
  return Math.floor((new Date(`${toDate}T12:00:00Z`).getTime() - new Date(`${fromDate}T12:00:00Z`).getTime()) / 86_400_000) + 1;
}

function leaveDays(fromDate: string, toDate: string) {
  let total = 0;
  for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (day === 0) continue;
    total += day === 6 ? 0.5 : 1;
  }
  return total;
}

export function buildAbsenceAndLeaveRows(input: {
  dailyRows: DailyAttendanceRow[];
  leave: ReportingLeave[];
  employees: ReportingEmployee[];
  reportStart: string;
  reportEnd: string;
}) {
  const employeeNames = new Map(input.employees.map((employee) => [employee.id, employee.name]));
  const rows: AbsenceAndLeaveRow[] = input.leave
    .filter((leave) => leave.status === 'approved' && leave.startDate <= input.reportEnd && leave.endDate >= input.reportStart && employeeNames.has(leave.staffId))
    .map((leave) => {
      const fromDate = leave.startDate < input.reportStart ? input.reportStart : leave.startDate;
      const toDate = leave.endDate > input.reportEnd ? input.reportEnd : leave.endDate;
      return {
        id: `leave-${leave.id}`,
        days: leaveDays(fromDate, toDate),
        employeeName: employeeNames.get(leave.staffId)!,
        reason: leaveTypeLabel(leave.type),
        branchName: leave.branchName,
        fromDate,
        toDate,
        notes: leave.reason,
        unapprovedAbsence: false,
      };
    });

  const absenceDays = input.dailyRows
    .filter((row) => row.status === 'Absent')
    .sort((a, b) => a.employeeId.localeCompare(b.employeeId) || a.branchId.localeCompare(b.branchId) || a.date.localeCompare(b.date));
  for (const absence of absenceDays) {
    const previous = rows.at(-1);
    if (previous?.unapprovedAbsence && previous.employeeName === absence.employeeName && previous.branchName === absence.branchName && addDays(previous.toDate, 1) === absence.date) {
      previous.toDate = absence.date;
      previous.days = calendarDays(previous.fromDate, previous.toDate);
      continue;
    }
    rows.push({
      id: `absence-${absence.employeeId}-${absence.date}`,
      days: 1,
      employeeName: absence.employeeName,
      reason: 'Absent (no approved leave)',
      branchName: absence.branchName,
      fromDate: absence.date,
      toDate: absence.date,
      notes: absence.notes,
      unapprovedAbsence: true,
    });
  }

  return rows.sort((a, b) => a.fromDate.localeCompare(b.fromDate) || a.branchName.localeCompare(b.branchName) || a.employeeName.localeCompare(b.employeeName));
}
