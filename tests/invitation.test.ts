import assert from 'node:assert/strict';
import test from 'node:test';
import { buildActivationOtpParams } from '../lib/auth/invitation.ts';

test('verifies invitation codes as email OTPs', () => {
  assert.deepEqual(buildActivationOtpParams(' HR@PITS.CO.ZA ', ' 848538 '), {
    email: 'hr@pits.co.za',
    token: '848538',
    type: 'email',
  });
});
