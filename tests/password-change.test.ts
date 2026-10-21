import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePasswordChange } from '../lib/auth/password-change.ts';

test('accepts a valid password change', () => {
  assert.equal(validatePasswordChange('OldPass!234', 'NewPass!567', 'NewPass!567'), null);
});

test('requires the current password and matching new passwords', () => {
  assert.match(validatePasswordChange('', 'NewPass!567', 'NewPass!567') ?? '', /current password/);
  assert.match(validatePasswordChange('OldPass!234', 'NewPass!567', 'Different!8') ?? '', /do not match/);
});

test('rejects short or unchanged passwords', () => {
  assert.match(validatePasswordChange('OldPass!234', 'short', 'short') ?? '', /eight characters/);
  assert.match(validatePasswordChange('OldPass!234', 'OldPass!234', 'OldPass!234') ?? '', /different/);
});
