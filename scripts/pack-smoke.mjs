import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp(path.join(tmpdir(), 'omnigami-mcp-pack-'));
const env = { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}` };
const npm = process.env.npm_execpath;
assert.ok(npm, 'Run with npm run test:pack on Node 24.22.1+');
const inspectorIndex = process.argv.indexOf('--inspector');
const inspector = inspectorIndex < 0 ? null : path.resolve(process.argv[inspectorIndex + 1]);
function run(command, args, cwd, seconds = 120) {
  return execFileSync('perl', ['-e', 'alarm shift; exec @ARGV', String(seconds), command, ...args], {
    cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 5_000_000,
  });
}
const npmRun = (args, cwd) => run(process.execPath, [npm, ...args], cwd);
try {
  const source = path.join(temp, 'source'), consumer = path.join(temp, 'consumer');
  await mkdir(source); await mkdir(consumer);
  for (const item of ['src', 'data', 'scripts', 'package.json', 'package-lock.json', 'README.md', 'LICENSE']) await cp(path.join(root, item), path.join(source, item), { recursive: true });
  const [packed] = JSON.parse(npmRun(['pack', '--json'], source));
  const expectedFiles = ['LICENSE', 'README.md', 'package.json', 'dist/data/catalogue.json', ...['catalogue', 'compound', 'recommend', 'search', 'server'].map((f) => `dist/src/${f}.mjs`)];
  assert.deepEqual(packed.files.map((f) => f.path).sort(), expectedFiles.sort(), 'Unexpected npm artifact contents');
  npmRun(['install', '--prefix', consumer, '--ignore-scripts', '--no-audit', '--no-fund', path.join(source, packed.filename)], consumer);
  const bin = path.join(consumer, 'node_modules/.bin/omnigami-mcp');
  assert.ok((await stat(bin)).mode & 0o111, 'Installed bin must be executable');
  const installed = JSON.parse(await readFile(path.join(consumer, 'node_modules/@omnigami-ai/mcp/package.json'), 'utf8'));
  assert.equal(installed.mcpName, 'io.github.omnigami-ai/mcp');
  function invoke(method, name, input) {
    const args = ['--cli', bin, '--offline', '--method', method];
    if (name) args.push('--tool-name', name);
    for (const [key, value] of Object.entries(input ?? {})) args.push('--tool-arg', `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
    const raw = JSON.parse(inspector ? run(process.execPath, [inspector, ...args], consumer, 45)
      : npmRun(['exec', '--yes', '--package=@modelcontextprotocol/inspector@2.14.0', '--', 'mcp-inspector', ...args], consumer));
    assert.ok(!raw.isError, `${name} returned an MCP error`);
    return method === 'tools/list' ? raw : raw.structuredContent ?? JSON.parse(raw.content.find((c) => c.type === 'text').text);
  }
  const listed = invoke('tools/list');
  assert.deepEqual(listed.tools.map((t) => t.name).sort(), ['get_skill', 'recommend', 'search_skills']);
  const search = invoke('tools/call', 'search_skills', { query: 'free launch video', free: true });
  assert.equal(search.results[0].slug, 'product-film');
  const detail = invoke('tools/call', 'get_skill', { slug: 'product-film' });
  assert.ok(detail.found && detail.install_prompt.startsWith('Install the Product film skill'));
  const recommendation = invoke('tools/call', 'recommend', { job: 'Make a free launch video for my working app, wide for the website.' });
  assert.equal(recommendation.pick.slug, 'product-film');
  console.log(JSON.stringify({ package: packed.id, filename: packed.filename, size: packed.size, unpackedSize: packed.unpackedSize,
    shasum: packed.shasum, integrity: packed.integrity, files: packed.files, node: process.version,
    inspector: '@modelcontextprotocol/inspector 2.14.0 CLI', cleanInstall: true,
    tools: listed.tools.map((t) => t.name), calls: ['search_skills', 'get_skill', 'recommend'].map((tool) => ({ tool, passed: true })) }, null, 2));
} finally { await rm(temp, { recursive: true, force: true }); }
