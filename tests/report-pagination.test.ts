import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchAllPages } from '../lib/reports/pagination.ts';

test('retrieves every row when a report exceeds the Supabase response cap', async () => {
  const source = Array.from({ length: 2_281 }, (_, index) => ({ id: index + 1 }));
  const requestedRanges: Array<[number, number]> = [];

  const result = await fetchAllPages(async (from, to) => {
    requestedRanges.push([from, to]);
    return { data: source.slice(from, to + 1), error: null };
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.data, source);
  assert.deepEqual(requestedRanges, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test('returns a page error without presenting a partial report as complete', async () => {
  const result = await fetchAllPages(async (from) => from === 0
    ? { data: Array.from({ length: 1_000 }, (_, index) => index), error: null }
    : { data: null, error: { message: 'Page failed' } });

  assert.equal(result.data, null);
  assert.equal(result.error?.message, 'Page failed');
});
