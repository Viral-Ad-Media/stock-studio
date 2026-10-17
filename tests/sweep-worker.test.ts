import test from 'node:test';
import assert from 'node:assert/strict';
import manifest from '../config/sweep/acceptance-cases.json';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sessionFor, previousSessions, scheduleSlot, localEpoch } from '../lib/sweep/calendar.mjs';
import { parseChart } from '../lib/sweep/yahoo.mjs';
import { scheduledTick } from '../lib/sweep/scheduler.mjs';
import { readJSON } from '../lib/sweep/storage.mjs';
import { historicalEvidence, validateHistoricalTape } from '../lib/sweep/history.mjs';
import { rankingSessions, validateCatalog } from '../lib/sweep/universe-acquisition.mjs';
import { inspectSweep } from '../lib/sweep/core.mjs';

const epoch = (date: string, hour: number, minute: number) => localEpoch(date, hour, minute, 'America/Chicago');

test('calendar follows Chicago DST and published holidays and early closes', () => {
  assert.equal(new Date(sessionFor('2026-10-16')!.start * 1000).toISOString(), '2026-10-16T13:30:00.000Z');
  assert.equal(new Date(sessionFor('2026-11-02')!.start * 1000).toISOString(), '2026-11-02T14:30:00.000Z');
  assert.equal(sessionFor('2026-10-17'), null);
  assert.equal(sessionFor('2026-11-26'), null);
  assert.equal(sessionFor('2026-11-27')!.end, epoch('2026-11-27', 12, 0));
  assert.throws(() => sessionFor('2028-01-03'), /UNSUPPORTED/);
  assert.throws(() => sessionFor('2026-02-30'), /INVALID_DATE/);
});
test('schedule includes open and final bar capture, never weekend or post-close captures', () => {
  assert.equal(scheduleSlot(epoch('2026-10-16', 8, 30))!.mode, '--capture');
  assert.equal(scheduleSlot(epoch('2026-10-16', 15, 0))!.mode, '--capture');
  assert.equal(scheduleSlot(epoch('2026-10-16', 15, 1)), null);
  assert.equal(scheduleSlot(epoch('2026-10-17', 8, 30)), null);
  assert.equal(scheduleSlot(epoch('2026-11-27', 12, 0))!.mode, '--capture');
  assert.equal(scheduleSlot(epoch('2026-11-27', 12, 5)), null);
  assert.equal(scheduleSlot(epoch('2026-11-27', 15, 5))!.mode, '--score');
  assert.equal(scheduleSlot(epoch('2026-11-26', 15, 5))!.mode, '--score');
});
test('previous sessions skip exchange holidays and weekends', () => {
  assert.deepEqual(previousSessions('2026-07-06', 2).map(s => s.date), ['2026-07-01', '2026-07-02']);
});
test('historical Yahoo without tradingPeriods uses the explicit calendar and rejects mismatches', () => {
  const s = sessionFor('2026-11-27')!;
  const body: any = { chart: { result: [{ meta: { symbol: 'DEMO', exchangeTimezoneName: 'America/New_York' }, timestamp: [s.start, s.end], indicators: { quote: [{ open: [100, null], high: [101, null], low: [99, null], close: [100, null] }] } }] } };
  const parsed = parseChart(body, '1m', s.end + 60);
  assert.equal(parsed.bars.length, 1);
  assert.equal(parsed.windows[0]!.end, s.end);
  body.chart.result[0].tradingPeriods = [[{ start: s.start, end: s.end + 10800 }]];
  assert.throws(() => parseChart(body, '1m', s.end + 60), /METADATA_CALENDAR_MISMATCH/);
});
test('worker claims a slot durably, skips duplicate execution, and records failed runs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sweep-worker-'));
  try {
    let runs = 0;
    const now = epoch('2026-10-16', 8, 35);
    const run = async () => { runs++; return { code: 0, output: 'captured' }; };
    assert.equal((await scheduledTick(dir, now, run)).status, 'COMPLETED');
    assert.equal((await scheduledTick(dir, now + 15, run)).status, 'ALREADY_ATTEMPTED');
    assert.equal(runs, 1);
    assert.equal((await scheduledTick(dir, now + 300, async () => { throw new Error('provider unavailable'); })).status, 'FAILED');
    assert.equal((await readJSON(join(dir, 'scheduler-state.json'))).reason, 'provider unavailable');
    assert.equal((await readFile(join(dir, 'scheduler-events.jsonl'), 'utf8')).trim().split('\n').length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('worker has no side effects outside a schedule slot', async () => {
  assert.deepEqual(await scheduledTick('/nonexistent-path', epoch('2026-10-17', 8, 35), async () => { assert.fail('must not run'); }), { status: 'IDLE' });
});
test('ranking acquisition requires all requested daily volumes and a complete GICS catalog', () => {
  const sessions = previousSessions('2026-10-16', 2);
  const bars = sessions.map(s => ({ t: s.start, o: 100, h: 101, l: 99, c: 100, v: 20 }));
  assert.deepEqual(rankingSessions({ bars }, sessions).map((r: { volume: number }) => r.volume), [20, 20]);
  assert.throws(() => rankingSessions({ bars: bars.slice(1) }, sessions), /MISSING_DAILY/);
  assert.throws(() => rankingSessions({ bars: bars.map(b => ({ ...b, v: null })) }, sessions), /MISSING_DAILY/);
  assert.throws(() => validateCatalog({ scope: 'SP500', rows: [] }), /COMPLETE_GICS/);
});
for (const item of manifest) {
  test('historical evidence integrity: ' + item.id, async () => {
    const tape = JSON.parse(await readFile(join(process.cwd(), 'tests/fixtures/sweep/historical', item.id + '.json'), 'utf8'));
    validateHistoricalTape(tape, item);
    assert.equal(tape.bars.length, 390);
    assert.equal(tape.context.sessions.length, 5);
    const evidence = historicalEvidence(tape, item);
    assert.equal(evidence.briefExtremeObserved, item.ticker === 'META' ? false : item.extreme == null ? null : true);
    tape.bars[0].o += .001;
    assert.throws(() => validateHistoricalTape(tape, item), /HASH_MISMATCH|INVALID_BAR/);
  });
}
test('real MU trap is excluded by its stated 1017 opening level without loosening any filter', async () => {
  const tape = JSON.parse(await readFile(join(process.cwd(), 'tests/fixtures/sweep/historical/MU-2026-10-12.json'), 'utf8'));
  const result = inspectSweep({ ...tape, asOf: tape.session.end, level: { price: 1017, name: 'prior low', knownAt: tape.session.start },
    semantics: { velocityOrigin: 'open', reclaimCandle: 'following', extreme: 'first-breach', consume: 'first-breach', lookback: 'extreme' } });
  assert.equal(result.reason, 'GAP_THROUGH');
});
