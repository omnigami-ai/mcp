import { readFile, writeFile } from 'node:fs/promises';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
const base = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', base), 'utf8'));
// Schema linked by the current official MCP Registry quickstart. Recheck at release.
export const schemaUrl = 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json';
const file = new URL('publishing/server.json', base);
if (process.argv.includes('--generate')) {
  const server = { $schema: schemaUrl, name: pkg.mcpName, description: 'Find omnigami skills: public catalogue search, install instructions and free-first recommendations.',
    repository: { url: 'https://github.com/omnigami-ai/mcp', source: 'github' }, version: pkg.version,
    packages: [{ registryType: 'npm', identifier: pkg.name, version: pkg.version, transport: { type: 'stdio' } }] };
  await writeFile(file, JSON.stringify(server, null, 2) + '\n');
}
const response = await fetch(schemaUrl, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
if (!response.ok) throw Error(`Official schema HTTP ${response.status}`);
const schema = await response.json();
const server = JSON.parse(await readFile(file, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
if (!validate(server)) throw Error(JSON.stringify(validate.errors));
if (server.name !== pkg.mcpName || server.version !== pkg.version || server.packages[0].identifier !== pkg.name || server.packages[0].version !== pkg.version) throw Error('Registry/package identities differ');
console.log(`Validated ${server.name} ${server.version} against ${schemaUrl}`);
