export const MINIMUM_OVERTIME_MINUTES = 60;

/** Overtime is payable only when the daily amount reaches a full hour. */
export function applyMinimumOvertime(minutes: number) {
  return minutes >= MINIMUM_OVERTIME_MINUTES ? minutes : 0;
}
