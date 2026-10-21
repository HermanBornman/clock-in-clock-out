import assert from 'node:assert/strict';
import test from 'node:test';
import { createTemporaryPassword } from '../lib/auth/temporary-password.ts';

test('creates a strong temporary password with every required character group', () => {
  const password = createTemporaryPassword();
  assert.equal(password.length, 12);
  assert.match(password, /[A-Z]/);
  assert.match(password, /[a-z]/);
  assert.match(password, /[0-9]/);
  assert.match(password, /[!@#$%&*?]/);
});

test('rejects temporary passwords shorter than twelve characters', () => {
  assert.throws(() => createTemporaryPassword(11), /at least 12/);
});
