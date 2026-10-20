export const LEAVE_TYPES = ['annual', 'sick', 'family_responsibility'] as const;

export type LeaveType = (typeof LEAVE_TYPES)[number];

export function leaveTypeLabel(type: LeaveType) {
  if (type === 'annual') return 'Annual leave';
  if (type === 'sick') return 'Sick leave';
  return 'Family responsibility leave';
}
