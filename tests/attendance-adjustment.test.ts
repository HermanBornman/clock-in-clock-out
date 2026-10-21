import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAttendanceAdjustmentWindow } from '../lib/attendance/adjustment.ts';

test('accepts a normal historical attendance correction', () => {
  assert.equal(validateAttendanceAdjustmentWindow('2026-10-19', '2026-10-19T05:30:00.000Z', '2026-10-19T15:00:00.000Z'), null);
});

test('accepts a valid overnight shift ending the following morning', () => {
  assert.equal(validateAttendanceAdjustmentWindow('2026-10-19', '2026-10-19T20:00:00.000Z', '2026-10-20T04:00:00.000Z'), null);
});

test('rejects reversed, wrong-date and excessively long corrections', () => {
  assert.equal(validateAttendanceAdjustmentWindow('2026-10-19', '2026-10-19T15:00:00.000Z', '2026-10-19T05:30:00.000Z'), 'Clock-out must be after clock-in.');
  assert.equal(validateAttendanceAdjustmentWindow('2026-10-19', '2026-10-18T05:30:00.000Z', '2026-10-19T15:00:00.000Z'), 'Clock-in must fall on the attendance work date.');
  assert.equal(validateAttendanceAdjustmentWindow('2026-10-19', '2026-10-19T05:30:00.000Z', '2026-10-20T06:00:00.000Z'), 'An adjusted shift cannot be longer than 24 hours.');
});
