import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Catalogue } from '../src/catalogue.mjs';
import { recommend } from '../src/recommend.mjs';
const snapshot = JSON.parse(await readFile(new URL('../data/catalogue.json', import.meta.url)));
for (const [job, slugs] of [
  ['Make a launch video and an investor deck.', ['product-film', 'pitch-deck']],
  ['Make investor slides plus an App Store video.', ['pitch-deck', 'app-store-preview']],
  ['Make an App Store screenshot set and a launch video.', ['app-store-screenshots', 'product-film']],
  ['Make a launch video, also a self-read sales deck.', ['product-film', 'sales-deck']],
  ['Make light device mockups & share cards for every page.', ['device-mockups', 'share-cards']],
  ['Need an investor deck; make a product deck to present live too.', ['pitch-deck', 'product-deck']],
  ['Make a launch video, an investor deck.', ['product-film', 'pitch-deck']],
  ['Make a launch video as well as a screenshot set.', ['product-film', 'app-store-screenshots']],
  ['Make a product deck and a sales deck for reading without a presenter.', ['product-deck', 'sales-deck']],
  ['Make a video and a deck.', ['product-film', 'product-deck']],
  ['Make a sales deck and a launch video.', ['sales-deck', 'product-film']],
]) test(`compound asks which named output first: ${job}`, async () => {
  const catalogue = new Catalogue(snapshot, { offline: true });
  catalogue.get = () => { throw Error('Do not fetch details before the user chooses'); };
  const answer = await recommend(catalogue, job);
  assert.equal(answer.status, 'needs_clarification');
  assert.equal(answer.pick, null);
  assert.deepEqual(answer.choices.map((c) => c.slug), slugs);
  for (const { name } of answer.choices) assert.ok(answer.question.includes(name));
  assert.match(answer.question, /first/);
  assert.equal(answer.install_prompt, undefined);
});
for (const job of [
  'Make a launch video, wide and tall.',
  'Make a product deck as HTML, PDF and MP4.',
  'Make an App Store video, not a screenshot set.',
  'Make a launch video and not an investor deck.',
  'Make a launch video and no presentation.',
  'Make a launch video and use supplied screenshots.',
  'Make a launch video for our investor deck.',
  'Make a product deck with screenshots and slides from our app.',
]) test(`one deliverable stays a single job: ${job}`, async () => {
  const answer = await recommend(new Catalogue(snapshot, { offline: true }), job);
  assert.equal(answer.choices, undefined);
});
