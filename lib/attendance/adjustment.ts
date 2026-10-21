const MAX_SHIFT_MILLISECONDS = 24 * 60 * 60 * 1000;
const MAX_OVERNIGHT_WINDOW_MILLISECONDS = 36 * 60 * 60 * 1000;

export function validateAttendanceAdjustmentWindow(workDate: string, clockIn: string | null, clockOut: string | null) {
  const workDayStart = Date.parse(`${workDate}T00:00:00+02:00`);
  const clockInTime = clockIn === null ? null : Date.parse(clockIn);
  const clockOutTime = clockOut === null ? null : Date.parse(clockOut);
  if (!Number.isFinite(workDayStart) || (clockInTime !== null && !Number.isFinite(clockInTime)) || (clockOutTime !== null && !Number.isFinite(clockOutTime))) return 'One or more attendance times are invalid.';
  if (clockInTime !== null && (clockInTime < workDayStart || clockInTime >= workDayStart + MAX_SHIFT_MILLISECONDS)) return 'Clock-in must fall on the attendance work date.';
  if (clockOutTime !== null && (clockOutTime < workDayStart || clockOutTime > workDayStart + MAX_OVERNIGHT_WINDOW_MILLISECONDS)) return 'Clock-out must be on the work date or the following morning.';
  if (clockInTime !== null && clockOutTime !== null) {
    if (clockOutTime <= clockInTime) return 'Clock-out must be after clock-in.';
    if (clockOutTime - clockInTime > MAX_SHIFT_MILLISECONDS) return 'An adjusted shift cannot be longer than 24 hours.';
  }
  return null;
}
