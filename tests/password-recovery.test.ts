import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecoveryOtpParams, recoveryRequestAllowed } from '../lib/auth/password-recovery.ts';

test('verifies scanner-safe recovery codes using the recovery OTP type', () => {
  assert.deepEqual(buildRecoveryOtpParams(' Admin@Example.COM ', ' 123456 '), {
    email: 'admin@example.com',
    token: '123456',
    type: 'recovery',
  });
});

test('limits password recovery requests to one per minute', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  assert.equal(recoveryRequestAllowed('2026-10-21T11:59:30Z', now), false);
  assert.equal(recoveryRequestAllowed('2026-10-21T11:59:00Z', now), true);
  assert.equal(recoveryRequestAllowed(null, now), true);
});
