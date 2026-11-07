import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { LLMS, ORIGIN, parseTable, parseDetails, publicGet } from '../src/catalogue.mjs';

// Compare both directions: additions, removals and held paid skills are drift too.
export function snapshotDiff(snapshot, current, fields, label) {
  const previous = new Map(snapshot.skills.map((s) => [s.slug, s]));
  const next = new Map(current.map((s) => [s.slug, s]));
  const differences = [];
  for (const slug of new Set([...previous.keys(), ...next.keys()])) {
    if (!previous.has(slug)) differences.push(`${label}: ${slug} is available but absent from the bundle`);
    else if (!next.has(slug)) differences.push(`${label}: ${slug} is removed or unavailable`);
    else for (const field of fields) {
      const get = (s) => field.split('.').reduce((v, k) => v?.[k], s);
      if (JSON.stringify(get(previous.get(slug))) !== JSON.stringify(get(next.get(slug)))) differences.push(`${label}: ${slug} changed ${field}`);
    }
  }
  return differences;
}

export async function siteFacts(siteDirectory) {
  const site = path.resolve(siteDirectory);
  const { outputFiles } = await build({
    stdin: { contents: `export { skills, skillRepo } from './src/data/skills.ts'; export { makesLine } from './src/data/finder.ts'; export { onSale } from './src/lib/on-sale.ts';`, resolveDir: site },
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  });
  const cwd = process.cwd();
  // Execute the site's actual availability helper in the directory it expects.
  process.chdir(site);
  try {
    const source = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
    return source.skills.filter((s) => s.free || source.onSale(s)).map((s) => ({
      slug: s.slug, name: s.name, free: s.free, price: s.free ? undefined : s.price,
      makes: source.makesLine(s), install: { npx: `npx skills add ${source.skillRepo(s.slug)}` },
      request: `Install the ${s.name} skill from ${ORIGIN}/skills/${s.slug}/install.md, then: ${s.prompt.charAt(0).toLowerCase() + s.prompt.slice(1)}`,
      asks: s.asks, requirements: s.requirements,
      files: s.makes.map((m) => `\`${m.file}\`: ${m.what}`),
    }));
  } finally { process.chdir(cwd); }
}

const fields = ['name', 'free', 'price', 'makes', 'install.npx', 'request', 'asks', 'requirements', 'files'];
export async function checkSnapshot(snapshot, { site, live = true, get = publicGet } = {}) {
  const differences = [];
  if (site) differences.push(...snapshotDiff(snapshot, await siteFacts(site), fields, 'site source'));
  if (live) {
    const rows = parseTable(await get(LLMS), snapshot);
    const current = [];
    for (let i = 0; i < rows.length; i += 4) {
      current.push(...await Promise.all(rows.slice(i, i + 4).map(async (s) => {
        const [md, html] = await Promise.all([get(s.installMd), get(s.page)]);
        return parseDetails(md, html, s);
      })));
    }
    differences.push(...snapshotDiff(snapshot, current, fields, 'live public pages'));
  }
  return differences;
}

async function findSite() {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 7; i++, dir = path.dirname(dir)) {
    const site = path.join(dir, 'site');
    try { await access(path.join(site, 'src/data/skills.ts')); return site; } catch { /* Try ancestor. */ }
  }
}
async function main() {
  const args = process.argv.slice(2);
  if (args.some((a, i) => a !== '--live' && a !== '--site' && args[i - 1] !== '--site') || (args.includes('--site') && !args[args.indexOf('--site') + 1])) throw Error('Usage: npm run check:snapshot -- [--live | --site /path/to/site]');
  const site = args.includes('--live') ? undefined : args.includes('--site') ? args[args.indexOf('--site') + 1] : await findSite();
  const snapshot = JSON.parse(await readFile(new URL('../data/catalogue.json', import.meta.url), 'utf8'));
  const differences = await checkSnapshot(snapshot, { site });
  if (differences.length) throw Error(`Snapshot drift:\n${differences.join('\n')}\nRefresh and review the snapshot, then rebuild before release.`);
  console.log(`Snapshot ${snapshot.generated}: ${snapshot.skills.length} skills match ${site ? 'site/src/data/skills.ts and ' : ''}live public catalogue/install pages.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => { console.error(err.message); process.exitCode = 1; });
}
