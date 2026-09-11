import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStaffDecisionEmail } from '../lib/leave/email-content.ts';
import { buildHrLeaveMessage, buildStaffDecisionMessage } from '../lib/leave/sms-content.ts';
import { normalizeSouthAfricanMobile } from '../lib/notifications/sms-format.ts';

test('normalizes South African mobile numbers to E.164', () => {
  assert.equal(normalizeSouthAfricanMobile('082 123 4567'), '+27821234567');
  assert.equal(normalizeSouthAfricanMobile('+27 82 123 4567'), '+27821234567');
  assert.equal(normalizeSouthAfricanMobile('+27 79 514 4898'), '+27795144898');
  assert.equal(normalizeSouthAfricanMobile('0111234567'), null);
});

test('builds an HR leave-submission SMS without the private note', () => {
  const body = buildHrLeaveMessage('Employee One', 'CBD', 'annual', '2026-09-20', '2026-09-22');
  assert.match(body, /Employee One/);
  assert.match(body, /annual leave/);
  assert.doesNotMatch(body, /private note/i);
});

test('builds approved and rejected staff SMS messages', () => {
  assert.match(buildStaffDecisionMessage('sick', '2026-09-20', '2026-09-20', 'approved'), /was approved/);
  assert.match(buildStaffDecisionMessage('annual', '2026-10-01', '2026-10-03', 'rejected'), /was rejected/);
});

test('builds a staff decision email and escapes employee HTML', () => {
  const email = buildStaffDecisionEmail('One <Two>', 'annual', '2026-10-01', '2026-10-03', 'approved');
  assert.match(email.subject, /approved/i);
  assert.match(email.text, /One <Two>/);
  assert.match(email.html, /One &lt;Two&gt;/);
  assert.doesNotMatch(email.html, /One <Two>/);
});
