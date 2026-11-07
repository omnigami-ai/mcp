import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotDiff, checkSnapshot } from '../scripts/check-snapshot.mjs';
import { readFile } from 'node:fs/promises';
const snapshot = JSON.parse(await readFile(new URL('../data/catalogue.json', import.meta.url)));
for (const field of ['price', 'free', 'request', 'install.npx']) test(`freshness fails on ${field} drift`, () => {
  const copy = structuredClone(snapshot.skills);
  if (field === 'install.npx') copy[0].install.npx = 'npx changed';
  else copy[0][field] = field === 'free' ? !copy[0].free : field === 'price' ? 99 : 'changed prompt';
  assert.equal(snapshotDiff(snapshot, copy, [field], 'fixture').length, 1);
});
test('freshness detects removed, newly held and added catalogue entries', () => {
  assert.match(snapshotDiff(snapshot, snapshot.skills.slice(1), [], 'fixture').join(), /removed or unavailable/);
  assert.match(snapshotDiff(snapshot, [...snapshot.skills, { slug: 'new-skill' }], [], 'fixture').join(), /absent from the bundle/);
});
test('freshness is independent of table order', () => {
  assert.deepEqual(snapshotDiff(snapshot, [...snapshot.skills].reverse(), ['price', 'request'], 'fixture'), []);
});
test('freshness fails closed when live data is unavailable or malformed', async () => {
  await assert.rejects(checkSnapshot(snapshot, { get: async () => { throw Error('unavailable'); } }), /unavailable/);
  await assert.rejects(checkSnapshot(snapshot, { get: async () => 'invalid table' }), /Unrecognized/);
});
