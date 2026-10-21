export const MINIMUM_OVERTIME_MINUTES = 60;
export const OVERTIME_BLOCK_MINUTES = 30;

/** Overtime starts at one hour, then pays only complete 30-minute blocks. */
export function applyMinimumOvertime(minutes: number) {
  if (minutes < MINIMUM_OVERTIME_MINUTES) return 0;
  return Math.floor(minutes / OVERTIME_BLOCK_MINUTES) * OVERTIME_BLOCK_MINUTES;
}
