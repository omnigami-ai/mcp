import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Catalogue } from '../src/catalogue.mjs';
import { recommend } from '../src/recommend.mjs';
const snapshot = JSON.parse(await readFile(new URL('../data/catalogue.json', import.meta.url)));
const fixtures = JSON.parse(await readFile(new URL('./finder-cases.json', import.meta.url)));
const cases = fixtures.cases;
for (const c of cases) test(`finder baseline: ${c.id}`, async () => {
  const answer = await recommend(new Catalogue(snapshot, { offline: true }), c.request, c.product.url);
  assert.equal(answer.status, c.expected.status);
  assert.equal(answer.pick?.slug ?? answer.pick?.id ?? null, c.expected.primary?.slug ?? c.expected.primary?.id ?? null);
  assert.equal(answer.alternative?.slug ?? answer.alternative?.id, c.expected.alternative.slug ?? c.expected.alternative.id);
  assert.equal(answer.reasons.match(/[.!?](?:\s|$)/g)?.length, 2);
  assert.ok(answer.catalogue.notes.some((n) => n.includes(snapshot.generated)));
  if (answer.status === 'recommend') {
    assert.equal(answer.install_line, c.expected.installLine);
    if (answer.pick.free) {
      // a free skill needs a free account: no open command, the installer's own steps, and a note not to approve for the person
      assert.equal(answer.install_line, null);
      assert.equal(answer.access.accountRequired, true);
      assert.match(answer.install_steps[0], /^npx omnigami login/);
      assert.match(answer.install_steps[1], new RegExp(`^npx omnigami install ${answer.pick.slug}`));
      assert.match(answer.notes.join(' '), /free with an omnigami account.*Never approve for them/);
    } else assert.equal(answer.access, undefined);
    assert.equal(answer.install_prompt, snapshot.skills.find((s) => s.slug === answer.pick.slug).request);
    assert.ok(answer.first_request.includes(c.product.url));
    if (!answer.pick.free && !c.constraints.ownedSkills.length) assert.match(answer.reasons, /GitHub/);
    assert.ok(answer.platforms.some((p) => p.name === 'Claude Code' && p.tested));
    assert.ok(answer.platforms.filter((p) => p.name !== 'Claude Code').every((p) => !p.tested));
  } else assert.equal(answer.install_line, undefined);
});
for (const [job, status] of [
  ['Make a free App Store video from my working app', 'no_match'],
  ['Use UI morph. I need a tall video.', 'no_match'],
  ['Make investor slides; no business facts are available', 'no_match'],
  ['Make a launch video, wide, only have screenshots and no app access', 'no_match'],
  ['Help with marketing', 'needs_clarification'],
  ['Make light device mockups at exactly 768 x 1024', 'no_match'],
]) test(`hard constraint: ${job}`, async () => assert.equal((await recommend(new Catalogue(snapshot, { offline: true }), job)).status, status));
test('offline paid reason dates the unverified price', async () => {
  const answer=await recommend(new Catalogue(snapshot,{offline:true}),'Make an App Store video from my working app, budget $5');
  assert.ok(answer.reasons.includes(`catalogue dated ${snapshot.generated}; confirm the current price on its page`));
});
test('a named still skill cannot satisfy a video job', async () => {
  const answer=await recommend(new Catalogue(snapshot,{offline:true}),'Use App Store screenshots. I need an App Store video, not a screenshot set.');
  assert.equal(answer.status,'no_match');
});
test('separate deliverables ask for separate briefs', async () => {
  assert.equal((await recommend(new Catalogue(snapshot,{offline:true}),'Make a launch video and an investor deck.')).status,'needs_clarification');
});
test('recommendations outside the baseline still include a conditional alternative', async () => {
  for(const job of ['Make an App Store screenshot set from my app','Make a flow diagram','Make an end card','Make share cards for every page']) {
    const answer=await recommend(new Catalogue(snapshot,{offline:true}),job);
    assert.equal(answer.status,'recommend'); assert.ok(answer.alternative?.condition);
  }
});

const recordingCase = fixtures.cases.find((c) => c.id === 'recording-only');
const recordingJob = recordingCase.request;
test('recording-only gives the verified price, conditional alternative and duration caveat', async () => {
  const answer = await recommend(new Catalogue(snapshot, { offline: true }), recordingJob);
  assert.equal(answer.pick.price_usd, recordingCase.expected.priceUsdAtSnapshot);
  assert.ok(answer.alternative.condition.includes('explicitly accept newly captured footage'));
  assert.ok(answer.notes.some((n) => n.includes('length follows the supplied recording')));
});
for (const [label, job] of [
  ['budget', recordingJob.replace('up to $10', 'up to $4')],
  ['shape', recordingJob.replace('tall film', 'square film')],
  ['named skill without recording input', `${recordingJob} Use Device film.`],
]) test(`recording-only still enforces ${label}`, async () => {
  const answer = await recommend(new Catalogue(snapshot, { offline: true }), job);
  assert.equal(answer.status, 'no_match');
  assert.equal(answer.install_line, undefined);
});
test('recording-only requires explicit asks, not broad input tags', async () => {
  const changed = structuredClone(snapshot);
  const recording = changed.skills.find((s) => s.slug === 'recording-film');
  recording.asks = ['A working app or demo'];
  recording.inputs = ['Screen recording'];
  const answer = await recommend(new Catalogue(changed, { offline: true }), recordingJob);
  assert.equal(answer.status, 'no_match');
  assert.match(answer.reasons, /does not list a supplied screen recording/);
  assert.equal(answer.install_line, undefined);
});
test('recording-only does not invent an unavailable skill', async () => {
  const changed = { ...snapshot, skills: snapshot.skills.filter((s) => s.slug !== 'recording-film') };
  const answer = await recommend(new Catalogue(changed, { offline: true }), recordingJob);
  assert.equal(answer.status, 'no_match');
  assert.equal(answer.install_line, undefined);
});
