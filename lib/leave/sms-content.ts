import { leaveTypeLabel as displayLeaveType, type LeaveType } from './types.ts';

export { leaveTypeLabel } from './types.ts';

export function buildHrLeaveMessage(employee: string, branch: string, type: LeaveType, start: string, end: string) {
  return `Presently: ${employee} (${branch}) applied for ${displayLeaveType(type).toLowerCase()}, ${start} to ${end}. Please review the request.`;
}

export function buildStaffDecisionMessage(type: LeaveType, start: string, end: string, decision: 'approved' | 'rejected') {
  return `Presently: Your ${displayLeaveType(type).toLowerCase()} request for ${start} to ${end} was ${decision}. Contact your manager if you need more information.`;
}
