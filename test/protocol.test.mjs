import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EXTENSION } from '../src/skills.mjs';
const AnyResult = z.object({}).passthrough();
const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': { extensions: { [EXTENSION]: {} } } };
test('built server handles real stdio calls, schema errors and private URLs', async () => {
  const transport = new StdioClientTransport({ command:process.execPath, args:[fileURLToPath(new URL('../dist/src/server.mjs',import.meta.url)),'--offline'],stderr:'pipe' });
  const client=new Client({name:'prototype-regression',version:'1.0.0'});
  try {
    await client.connect(transport);
    assert.deepEqual(client.getServerCapabilities().extensions[EXTENSION], {});
    assert.deepEqual((await client.request({ method: 'skills/list' }, AnyResult)).skills, []);
    assert.equal((await client.request({ method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2025-11-25' } } }, AnyResult)).tools.length, 3);
    await assert.rejects(client.request({ method: 'skills/get', params: { uri: 'skill://product-film/SKILL.md' } }, AnyResult), /No free indexed/);
    const { tools }=await client.listTools();
    assert.equal(tools.length,3);
    for(const t of tools) assert.equal(t.annotations.readOnlyHint,true);
    for(const args of [{ query:' ' },{query:'launch',kind:'banana'},{query:'launch',free:'false'}]) {
      const result=await client.callTool({name:'search_skills',arguments:args});
      assert.equal(result.isError,true);
    }
    for(const product_url of ['file:///etc/passwd','http://name:pass@127.0.0.1/','https://example.test/?secret=1']) {
      const result=await client.callTool({name:'recommend',arguments:{job:'a launch video',product_url}});
      assert.equal(result.isError,true);
    }
    const result=await client.callTool({name:'search_skills',arguments:{query:'launch',free:false}});
    assert.ok(result.structuredContent.results.length>0);
    assert.ok(result.structuredContent.results.every((s)=>s.free===false));
    assert.equal(result.content[0].text,JSON.stringify(result.structuredContent,null,2));
    const unknown=await client.callTool({name:'get_skill',arguments:{slug:'missing-skill'}});
    assert.equal(unknown.structuredContent.found,false);
    const traversal=await client.callTool({name:'get_skill',arguments:{slug:'../account'}});
    assert.equal(traversal.isError,true);
  } finally { await client.close(); }
});

for (const kind of ['good', 'tampered', 'traversal', 'oversize']) test(`skills extension over stdio: ${kind}`, async () => {
  const cache = await mkdtemp(path.join(tmpdir(), 'mcp-skills-protocol-'));
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/skills-server.mjs', import.meta.url)), kind, cache], stderr: 'pipe' });
  const client = new Client({ name: 'skills-protocol', version: '1.0.0' });
  try {
    await client.connect(transport);
    const discovered = await client.request({ method: 'server/discover', params: { _meta: meta } }, AnyResult);
    assert.deepEqual(discovered.capabilities.extensions[EXTENSION], {});
    assert.ok(discovered.supportedVersions.includes('2026-07-28'));
    await assert.rejects(client.request({ method: 'skills/get', params: { uri: 'skill://cutout-film/SKILL.md', _meta: meta } }, AnyResult), (err) => err.code === -32602);
    if (kind !== 'good') {
      await assert.rejects(client.request({ method: 'skills/get', params: { uri: 'skill://sample/SKILL.md', _meta: meta } }, AnyResult), (err) => err.code === -32603 && /digest|Unsafe|too large/.test(err.message));
      await assert.rejects(client.request({ method: 'skills/list', params: { _meta: meta } }, AnyResult));
      return;
    }
    const listed = await client.request({ method: 'skills/list', params: { _meta: meta } }, AnyResult);
    assert.equal(listed.resultType, 'complete'); assert.equal(listed.ttlMs, 0); assert.equal(listed.cacheScope, 'public');
    assert.equal(listed.skills.length, 1); assert.equal(listed.skills[0].resources.length, 3);
    const gotten = await client.request({ method: 'skills/get', params: { uri: listed.skills[0].uri, _meta: meta } }, AnyResult);
    assert.deepEqual(gotten.skill, listed.skills[0]);
    for (const file of gotten.skill.resources) {
      const result = await client.readResource({ uri: file.uri, _meta: meta });
      assert.equal(result.contents.length, 1);
    }
    await assert.rejects(client.request({ method: 'skills/list', params: { cursor: 'bad', _meta: meta } }, AnyResult), (err) => err.code === -32602);
    await assert.rejects(client.request({ method: 'server/discover', params: {} }, AnyResult), (err) => err.code === -32602);
  } finally { await client.close(); await rm(cache, { recursive: true, force: true }); }
});

test('2026 stateless discovery works without initialize', async () => {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../dist/src/server.mjs', import.meta.url)), '--offline'], stderr: 'pipe' });
  const pending = new Map();
  transport.onmessage = (message) => pending.get(message.id)?.(message);
  let id = 0;
  const request = (method, params) => new Promise((resolve, reject) => {
    const current = ++id;
    pending.set(current, resolve);
    transport.send({ jsonrpc: '2.0', id: current, method, params }).catch(reject);
  });
  try {
    await transport.start();
    assert.ok((await request('server/discover', { _meta: meta })).result.capabilities.extensions[EXTENSION]);
    assert.deepEqual((await request('skills/list', { _meta: meta })).result.skills, []);
    assert.equal((await request('skills/list', {})).error.code, -32602);
    assert.equal((await request('tools/list', { _meta: meta })).result.tools.length, 3);
    assert.equal((await request('tools/call', { _meta: meta, name: 'search_skills', arguments: { query: 'launch' } })).result.resultType, 'complete');
    const invalid = await request('skills/list', { _meta: { ...meta, 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } });
    assert.equal(invalid.error.code, -32022);
  } finally { await transport.close(); }
});
