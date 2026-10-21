import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMissingClockOutEmail, previousJohannesburgDate } from '../lib/reports/missing-clock-out-content.ts';

test('selects the previous Johannesburg calendar date', () => {
  assert.equal(previousJohannesburgDate(new Date('2026-10-21T05:00:00Z')), '2026-10-20');
  assert.equal(previousJohannesburgDate(new Date('2026-11-01T05:00:00Z')), '2026-10-31');
});

test('builds a missing clock-out email and escapes staff details', () => {
  const email = buildMissingClockOutEmail('2026-10-20', [{ employeeName: 'One <Two>', branchName: 'CBD', organizationName: 'Pits & Co', workDate: '2026-10-20', clockIn: '07:30' }]);
  assert.match(email.subject, /2026-10-20/);
  assert.match(email.text, /One <Two>/);
  assert.match(email.html, /One &lt;Two&gt;/);
  assert.match(email.html, /Pits &amp; Co/);
  assert.doesNotMatch(email.html, /One <Two>/);
});
