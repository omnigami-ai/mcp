import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Skills } from '../../src/skills.mjs';
import { SKILL_INDEX } from '../../src/catalogue.mjs';
import { attachSkills, SkillsTransport } from '../../src/skills-protocol.mjs';
import { fixture } from './skill-archives.mjs';
const f = await fixture(process.argv[2]);
const skills = new Skills({ cacheDir: process.argv[3], fetchImpl: async (url) => {
  if (url === SKILL_INDEX) return new Response(f.index);
  if (url === f.row.url) return new Response(f.bytes);
  throw Error('Unexpected URL');
} });
const server = new McpServer({ name: 'fixture', version: '1.0.0' });
attachSkills(server, skills);
await server.connect(new SkillsTransport(new StdioServerTransport()));
