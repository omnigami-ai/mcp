// Live, opt-in experiment. Writes only temporary reconstructed folders, then removes them.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { publicBytes, SKILL_INDEX } from '../src/catalogue.mjs';
import { digest, parseIndex, unpack, EXTENSION } from '../src/skills.mjs';

const scratch = await mkdtemp(path.join(tmpdir(), 'omnigami-skills-e2e-'));
const resultSchema = z.object({}).passthrough();
const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'omnigami-skills-e2e', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': { extensions: { [EXTENSION]: {} } } };
const report = { date: new Date().toISOString(), node: process.version, skills: [] };
let received = 0, sent = 0;
class MeteredTransport extends StdioClientTransport {
  async start() {
    await super.start();
    this._process.stdout.on('data', (chunk) => { received += chunk.length; });
  }
  send(message) { sent += Buffer.byteLength(JSON.stringify(message) + '\n'); return super.send(message); }
}
const transport = new MeteredTransport({ command: process.execPath,
  args: [fileURLToPath(new URL('../dist/src/server.mjs', import.meta.url))], stderr: 'pipe' });
const client = new Client({ name: 'omnigami-skills-e2e', version: '1.0.0' });
const request = (method, params = {}) => client.request({ method, params: { ...params, _meta: meta } }, resultSchema, { timeout: 180000 });
try {
  const index = parseIndex(await publicBytes(SKILL_INDEX));
  report.indexNames = index.map((s) => s.name);
  await client.connect(transport);
  const discovered = await request('server/discover');
  assert.ok(discovered.capabilities.extensions[EXTENSION]);
  const startList = performance.now(), beforeList = received;
  const listed = []; let cursor;
  do {
    const page = await request('skills/list', cursor ? { cursor } : {});
    listed.push(...page.skills); cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(listed.map((s) => s.frontmatter.name), report.indexNames);
  report.list = { count: listed.length, seconds: (performance.now() - startList) / 1000, responseWireBytes: received - beforeList,
    manifests: listed.map((s) => ({ name: s.frontmatter.name, files: s.resources.length, bytes: s.resources.reduce((sum, r) => sum + r.size, 0) })) };
  console.error(`Listed ${listed.length} complete skills in ${report.list.seconds.toFixed(2)}s`);
  for (const name of ['product-film', 'whats-new']) {
    const row = index.find((s) => s.name === name);
    const archiveBytes = await publicBytes(row.url, { timeoutMs: 120000 });
    assert.equal(digest(archiveBytes), row.digest);
    // Validate paths before independent system-tar extraction for the comparison.
    await unpack(archiveBytes, row.digest);
    const archivePath = path.join(scratch, `${name}.tar.gz`);
    await writeFile(archivePath, archiveBytes);
    const original = path.join(scratch, `${name}-original`), rebuilt = path.join(scratch, `${name}-rebuilt`);
    await mkdir(original); await mkdir(rebuilt);
    execFileSync('tar', ['-xzf', archivePath, '-C', original]);
    const started = performance.now(), rx = received, tx = sent;
    const { skill } = await request('skills/get', { uri: `skill://${name}/SKILL.md` });
    let bytes = 0, binaryFiles = 0, largestResponse = 0;
    for (const file of skill.resources) {
      const before = received;
      const response = await request('resources/read', { uri: file.uri });
      largestResponse = Math.max(largestResponse, received - before);
      assert.equal(response.contents.length, 1);
      const content = response.contents[0];
      assert.equal(content.uri, file.uri);
      const decoded = content.blob !== undefined ? Buffer.from(content.blob, 'base64') : Buffer.from(content.text, 'utf8');
      if (content.blob !== undefined) binaryFiles++;
      assert.equal(decoded.length, file.size); assert.equal(digest(decoded), file.digest);
      const relative = file.uri.slice(`skill://${name}/`.length).split('/').map(decodeURIComponent).join('/');
      const target = path.join(rebuilt, relative);
      await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, decoded);
      assert.equal(digest(await readFile(target)), digest(await readFile(path.join(original, relative))));
      bytes += decoded.length;
    }
    const archiveFiles = execFileSync('tar', ['-tzf', archivePath], { encoding: 'utf8' }).trim().split('\n');
    assert.equal(skill.resources.length, archiveFiles.length);
    const result = { name, complete: true, files: skill.resources.length, binaryFiles, decodedBytes: bytes,
      archiveBytes: archiveBytes.length, digest: row.digest, seconds: (performance.now() - started) / 1000,
      responseWireBytes: received - rx, requestWireBytes: sent - tx, largestResponseWireBytes: largestResponse,
      baselineLimitExceeded: bytes > 16 * 1024 * 1024 };
    report.skills.push(result); console.error(JSON.stringify(result));
  }
  console.log(JSON.stringify(report, null, 2));
} finally { await client.close(); await rm(scratch, { recursive: true, force: true }); }
