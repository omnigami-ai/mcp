import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { searchSkills } from '../src/search.mjs';
const { skills } = JSON.parse(await readFile(new URL('../data/catalogue.json', import.meta.url)));
for (const [query, expected] of [
  ['a launch video for my app', 'product-film'], ['store screenshots', 'app-store-screenshots'],
  ['a seed fundraising presentation for investors', 'pitch-deck'], ['a PDF to read and forward, no presenter', 'sales-deck'],
  ['present my product live with talking points', 'product-deck'], ['a square UI morph loop', 'ui-morph'],
  ['free light device mockups', 'device-mockups'], ['dark screen-lit mockups', 'screen-lit-mockups'],
  ['a release video from release notes', 'whats-new'], ['Product film', 'product-film'],
  ['flow diagram', 'flow-diagram'], ['share cards for every page', 'share-cards'],
]) test(`ranking: ${query}`, () => assert.equal(searchSkills(skills, query)[0]?.slug, expected));
test('filters respect literal kind and free=false', () => {
  assert.ok(searchSkills(skills, 'launch', { free: true }).every((s) => s.free));
  const paid = searchSkills(skills, 'launch', { free: false });
  assert.ok(paid.length > 0 && paid.every((s) => !s.free));
  for (const kind of ['film','shot','images','deck']) {
    const results = searchSkills(skills, 'product launch', { kind });
    assert.ok(results.length > 0 && results.every((s) => s.kind === kind));
  }
});
test('unknown/empty queries do not manufacture matches', () => {
  for (const query of ['zzxqvv', '', '  ', 'a the my']) assert.deepEqual(searchSkills(skills, query), []);
});
test('ranking is repeatable and respects result limit', () => {
  assert.deepEqual(searchSkills(skills, 'launch'), searchSkills([...skills].reverse(), 'launch'));
  assert.equal(searchSkills(skills, 'launch', { limit: 2 }).length, 2);
});
