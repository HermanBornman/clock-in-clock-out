import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanDigits, deriveBirthDateFromSouthAfricanId, isValidSouthAfricanIdNumber, maskIdentifier } from '../lib/staff/details.ts';

test('validates a South African ID checksum and derives a plausible birth date', () => {
  assert.equal(isValidSouthAfricanIdNumber('8001015009087'), true);
  assert.equal(deriveBirthDateFromSouthAfricanId('8001015009087', new Date('2026-09-11T00:00:00Z')), '1980-01-01');
});

test('does not derive birth date from an invalid ID number', () => {
  assert.equal(isValidSouthAfricanIdNumber('8001015009088'), false);
  assert.equal(deriveBirthDateFromSouthAfricanId('8001015009088'), null);
});

test('keeps identifiers as digits and masks all but the last four digits', () => {
  assert.equal(cleanDigits('800101 5009 087'), '8001015009087');
  assert.equal(maskIdentifier('8001015009087'), '•••••••••9087');
  assert.equal(maskIdentifier(null), null);
});
