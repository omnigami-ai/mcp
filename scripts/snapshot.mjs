import { readFile, writeFile } from 'node:fs/promises';
import { publicGet, parseTable, parseDetails, LLMS } from '../src/catalogue.mjs';
const file = new URL('../data/catalogue.json', import.meta.url);
const previous = JSON.parse(await readFile(file, 'utf8'));
const rows = parseTable(await publicGet(LLMS), previous);
const skills = [];
for (let i = 0; i < rows.length; i += 4) {
  skills.push(...await Promise.all(rows.slice(i, i + 4).map(async (s) => {
    const [md, html] = await Promise.all([publicGet(s.installMd), publicGet(s.page)]);
    return parseDetails(md, html, s);
  })));
}
await writeFile(file, JSON.stringify({ ...previous, generated: new Date().toISOString().slice(0, 10), skills }, null, 2) + '\n');
console.log(`Refreshed ${skills.length} public skills. Review the diff, run check:snapshot, and rebuild.`);
