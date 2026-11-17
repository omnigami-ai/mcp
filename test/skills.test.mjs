import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Skills, unpack, digest, parseIndex, safePath, frontmatter, LIMITS } from '../src/skills.mjs';
import { SKILL_INDEX, publicBytes } from '../src/catalogue.mjs';
import { archive, fixture, skillText } from './fixtures/skill-archives.mjs';

test('complete manifest, lossless binary/text reads, YAML and digest cache', async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'mcp-skills-test-'));
  try {
    const f = await fixture(); let calls = 0;
    const options = { cacheDir, fetchImpl: async (url) => { calls++; return new Response(url === SKILL_INDEX ? f.index : f.bytes); } };
    const skills = new Skills(options);
    const { skills: [entry] } = await skills.list();
    assert.equal(entry.frontmatter.name, 'sample');
    assert.deepEqual(entry.frontmatter.metadata, { sample: true });
    assert.equal(entry.resources.length, 3);
    assert.deepEqual((await skills.get(entry.uri)).skill, entry);
    for (const file of entry.resources) {
      const { contents: [content] } = await skills.read(file.uri);
      const bytes = content.blob !== undefined ? Buffer.from(content.blob, 'base64') : Buffer.from(content.text);
      assert.equal(bytes.length, file.size); assert.equal(digest(bytes), file.digest);
    }
    assert.equal((await skills.read('skill://sample/assets/data.bin')).contents[0].blob, 'AP+ACg==');
    assert.equal(calls, 2);
    await new Skills(options).get(entry.uri);
    assert.equal(calls, 3, 'restart uses the verified disk archive but re-reads the live index');
    const cached = path.join(cacheDir, `${f.row.digest.slice(7)}.tar.gz`);
    assert.deepEqual(await readFile(cached), f.bytes);
    await writeFile(cached, 'corrupt');
    await assert.rejects(new Skills(options).get(entry.uri), /Cached archive digest mismatch/);
  } finally { await rm(cacheDir, { recursive: true, force: true }); }
});

for (const kind of ['tampered', 'traversal', 'oversize']) test(`refuses ${kind} archive`, async () => {
  const f = await fixture(kind);
  await assert.rejects(unpack(f.bytes, f.row.digest), /digest mismatch|Unsafe|too large/);
});

test('refuses absolute paths, links, duplicate paths, file/dir conflicts, malformed gzip and excess file count', async () => {
  const root = [{ name: 'SKILL.md' }, skillText];
  for (const entries of [
    [root, [{ name: '/absolute' }, Buffer.from('x')]],
    [root, [{ name: 'link', type: 'symlink', linkname: '/tmp/escape' }]],
    [root, [{ name: 'hard', type: 'link', linkname: 'SKILL.md' }]],
    [root, root],
    [root, [{ name: 'file' }, Buffer.from('x')], [{ name: 'file/child' }, Buffer.from('x')]],
    Array.from({ length: LIMITS.files + 1 }, (_, i) => [{ name: i === 0 ? 'SKILL.md' : `file-${i}` }, skillText]),
  ]) {
    const bytes = await archive(entries);
    await assert.rejects(unpack(bytes, digest(bytes)));
  }
  const malformed = Buffer.from('not gzip');
  await assert.rejects(unpack(malformed, digest(malformed)));
  assert.throws(() => frontmatter(skillText, { name: 'other', description: 'wrong' }), /differs/);
  for (const p of ['../x', 'a/../b', '/x', 'a\\b', 'C:/x', 'a//b', 'a/./b', 'a\0b']) assert.equal(safePath(p), false);
});

test('index is the only source, Pro and arbitrary URIs are refused; offline performs no reads', async () => {
  const f = await fixture();
  const skills = new Skills({ fetchImpl: async (url) => { assert.equal(url, SKILL_INDEX); return new Response(f.index); } });
  for (const uri of ['skill://cutout-film/SKILL.md', 'skill://sample/../SKILL.md', 'skill://sample/%2e%2e/SKILL.md',
    'file:///etc/passwd', 'skill://sample/assets%2fdata.bin', 'skill://sample/SKILL.md?key=x']) await assert.rejects(skills.get(uri));
  const offline = new Skills({ offline: true, fetchImpl: () => { throw Error('Must not fetch'); } });
  assert.deepEqual(await offline.list(), { skills: [] });
  await assert.rejects(offline.get('skill://sample/SKILL.md'), /No free indexed/);
  assert.throws(() => parseIndex(Buffer.from(JSON.stringify({ skills: [{ ...f.row, free: false }] }))));
  for (const change of [{ digest: 'bad' }, { url: 'https://evil.example/sample.tar.gz' }, { url: f.row.url + '?x=1' }, { type: 'github' }]) {
    assert.throws(() => parseIndex(Buffer.from(JSON.stringify({ skills: [{ ...f.row, ...change }] }))));
  }
});

test('archive URL allowlist has no general network fallback and refuses redirects', async () => {
  for (const url of ['https://media.omnigami.ai/secret.tar.gz', 'https://media.omnigami.ai/m/skills/a.tar.gz?key=x',
    'https://media.omnigami.ai/m/skills/../a.tar.gz', 'http://media.omnigami.ai/m/skills/a.tar.gz', 'https://omnigami.ai/.well-known/agent-skills/other.json']) {
    await assert.rejects(publicBytes(url, { fetchImpl: () => { throw Error('should not fetch'); } }), /Not a public/);
  }
  await assert.rejects(publicBytes('https://media.omnigami.ai/m/skills/a.tar.gz', { fetchImpl: async (_url, init) => {
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); return new Response('', { status: 302 });
  } }), /HTTP 302/);
});

test('pagination covers the exact index and stale cursors or removed skills fail closed', async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'mcp-skills-pages-'));
  try {
    const f = await fixture();
    const bytes = await archive([[{ name: 'SKILL.md' }, Buffer.from(skillText.toString().replace('name: sample', 'name: other'))]]);
    const other = { ...f.row, name: 'other', digest: digest(bytes), url: `https://media.omnigami.ai/m/skills/other-${digest(bytes).slice(7, 23)}.tar.gz` };
    let rows = [f.row, other], broken = false;
    const skills = new Skills({ cacheDir, ttlMs: 0, fetchImpl: async (url) => {
      if (broken) throw Error('Index unavailable');
      return new Response(url === SKILL_INDEX ? JSON.stringify({ skills: rows }) : url === f.row.url ? f.bytes : bytes);
    } });
    const first = await skills.list();
    assert.equal(first.skills[0].frontmatter.name, 'sample');
    const second = await skills.list(first.nextCursor);
    assert.equal(second.skills[0].frontmatter.name, 'other'); assert.equal(second.nextCursor, undefined);
    rows = [other];
    await assert.rejects(skills.list(first.nextCursor), /Stale/);
    await assert.rejects(skills.read('skill://sample/SKILL.md'), /No free indexed/);
    broken = true;
    await assert.rejects(skills.get('skill://other/SKILL.md'), /Index unavailable/);
  } finally { await rm(cacheDir, { recursive: true, force: true }); }
});
