export type DailyStaff = { id: string };
export type DailyClockIn = { staffId: string; clockInMinute: number };

export function classifyDailyStatus(
  staff: DailyStaff[],
  clockIns: DailyClockIn[],
  approvedLeaveStaffIds: Iterable<string>,
  cutoffMinute = 8 * 60,
) {
  const leave = new Set(approvedLeaveStaffIds);
  const firstClockIn = new Map<string, number>();
  for (const entry of clockIns) {
    const current = firstClockIn.get(entry.staffId);
    if (current === undefined || entry.clockInMinute < current) firstClockIn.set(entry.staffId, entry.clockInMinute);
  }

  const late = staff.filter((person) => !leave.has(person.id) && (firstClockIn.get(person.id) ?? -1) > cutoffMinute);
  const absent = staff.filter((person) => !leave.has(person.id) && !firstClockIn.has(person.id));
  return { late, absent };
}
