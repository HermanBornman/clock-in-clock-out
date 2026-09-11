export function leaveTypeLabel(type: 'annual' | 'sick') {
  return type === 'annual' ? 'annual leave' : 'sick leave';
}

export function buildHrLeaveMessage(employee: string, branch: string, type: 'annual' | 'sick', start: string, end: string) {
  return `Presently: ${employee} (${branch}) applied for ${leaveTypeLabel(type)}, ${start} to ${end}. Please review the request.`;
}

export function buildStaffDecisionMessage(type: 'annual' | 'sick', start: string, end: string, decision: 'approved' | 'rejected') {
  return `Presently: Your ${leaveTypeLabel(type)} request for ${start} to ${end} was ${decision}. Contact your manager if you need more information.`;
}
