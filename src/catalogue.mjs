import { readFile } from 'node:fs/promises';

export const ORIGIN = 'https://omnigami.ai';
export const LLMS = `${ORIGIN}/llms.txt`;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const validSlug = (slug) => typeof slug === 'string' && slug.length <= 100 && slugPattern.test(slug);
export const decode = (s) => s.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, (v) => {
  const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
  return named[v] ?? String.fromCodePoint(v.startsWith('&#x') ? parseInt(v.slice(3), 16) : parseInt(v.slice(2), 10));
});
const section = (md, heading) => md.match(new RegExp(`^## ${heading}\\r?\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'))?.[1]?.trim() ?? '';
const bullets = (s) => s.split(/\r?\n/).filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
export function parseTools(text) {
  const block = section(text, 'Free tools');
  return [...block.matchAll(/^- \[([^\]]+)\]\((https:\/\/omnigami\.ai\/tools\/([a-z0-9-]+))\): (.+)$/gm)]
    .map(([, name, url, id, makes]) => ({ id, name, url, makes, free: true }));
}
const platformsOf = (html) => {
  const row = html.match(/class="runs"[\s\S]*?<\/div>/)?.[0] ?? '';
  const names = [...row.matchAll(/data-tip="([^"]+)"/g)].map((m) => decode(m[1]));
  return names.flatMap((n) => n.startsWith('Also ') ? n.slice(5).split(/, | and /) : [n])
    .map((name) => ({ name, tested: name === 'Claude Code' }));
};

// Parse only the labelled decision table, not marketing lists or instructions elsewhere in llms.txt.
const oldSizes = (bundled, slug) => bundled.skills.find((s) => s.slug === slug)?.sizes;
export function parseTable(text, bundled) {
  const table = text.split('## Which skill: the full table')[1]?.split(/^## /m)[0];
  if (!table || !table.includes('| slug | name | makes |')) throw new Error('Unrecognized live catalogue format');
  const previous = new Map(bundled.skills.map((s) => [s.slug, s]));
  const rows = [];
  const seen = new Set();
  for (const line of table.split(/\r?\n/)) {
    if (!/^\| [a-z0-9]+(?:-[a-z0-9]+)* \|/.test(line) || line.startsWith('| slug |')) continue;
    const c = line.split('|').slice(1, -1).map((s) => s.trim());
    if (c.length !== 9 || !validSlug(c[0]) || seen.has(c[0])) throw new Error('Invalid live catalogue row');
    seen.add(c[0]);
    const [slug, name, makesCell, jobs, inputs, cost, proof, install, page] = c;
    const kind = makesCell.includes('(single scene)') ? 'shot' : makesCell.split(':')[0];
    if (!['shot', 'film', 'images', 'deck'].includes(kind) || page !== `${ORIGIN}/skills/${slug}`) throw new Error('Invalid live catalogue facts');
    const free = cost === 'Free';
    const price = free ? undefined : Number(cost.match(/^\$(\d+(?:\.\d+)?)/)?.[1]);
    if (!free && !Number.isFinite(price)) throw new Error('Unknown live price');
    if (/not on sale|coming soon|on sale soon/i.test(cost)) continue;
    const npx = install.match(/`(npx skills add [^`]+)`/)?.[1];
    if (npx !== `npx skills add omnigami-ai/${slug}`) throw new Error('Unknown live install command');
    const old = previous.get(slug);
    const makes = makesCell.replace(/^(film|images|deck): /, '');
    rows.push({
      // Descriptive fallback is labelled separately; live eligibility always uses these current facts.
      ...old, slug, name, kind, makes, free, ...(free ? { price: undefined } : { price }), page,
      jobs: jobs === '-' ? [] : jobs.split(', '), inputs: inputs === '-' ? [] : inputs.split(', '),
      shapes: ['wide', 'square', 'tall'].filter((s) => new RegExp(`\\b${s}\\b`, 'i').test(makes)),
      installMd: `${page}/install.md`, install: { npx }, proof: { live: proof },
      tagline: old?.tagline ?? makes, metadataSource: old ? 'bundled descriptions; live table facts' : 'live table',
    });
  }
  if (!rows.length || rows.length > 500) throw new Error('Empty or oversized live catalogue');
  // Live decks describe their aspect ratio rather than saying "wide".
  for (const s of rows) {
    if (s.kind === 'deck' && /16:9/.test(s.makes)) s.shapes = ['wide'];
    if (s.kind === 'images') {
      s.sizes = [...s.makes.matchAll(/(\d+)×(\d+)/g)].map((m) => ({ width: Number(m[1]), height: Number(m[2]) }));
      for (const { width, height } of s.sizes) {
        const shape = width > height ? 'wide' : width < height ? 'tall' : 'square';
        if (!s.shapes.includes(shape)) s.shapes.push(shape);
      }
      // Simple Wide/Tall device sets publish their actual sizes in the bundled details.
      if (!s.sizes.length && oldSizes(bundled, s.slug)) s.sizes = oldSizes(bundled, s.slug);
    }
  }
  return rows;
}

export function parseDetails(md, html, row) {
  if (!md.startsWith(`# Install ${row.name}\n`) || !md.includes(`Skill page: ${row.page}`)) throw new Error('Unrecognized install page');
  let request = [...html.matchAll(/data-copy="([^"]+)"/g)].map((m) => decode(m[1]))
    .find((s) => s.startsWith(`Install the ${row.name} skill from ${row.installMd}, then: `));
  const ask = section(md, 'Then').match(/^Ask: \"([^\"]+)\"/m)?.[1];
  const promptSource = request ? 'page Copy install prompt' : 'public install.md Ask line in site copy-prompt format';
  if (!request && ask) request = `Install the ${row.name} skill from ${row.installMd}, then: ${ask.charAt(0).toLowerCase() + ask.slice(1)}`;
  if (!request) throw new Error('Install prompt missing from public sources');
  if (!md.includes(row.install.npx)) throw new Error('Install command differs from table');
  const asks = bullets(section(md, 'Then'));
  const requirements = bullets(section(md, 'Requirements'));
  const platforms = platformsOf(html);
  if (!platforms.length || !asks.length || !requirements.length) throw new Error('Incomplete skill details');
  const lede = md.split('\n\n')[1];
  return { ...row, lede, goodFor: bullets(section(md, 'Works best for')), asks, requirements, request, platforms,
    prompt_source: promptSource, files: bullets(section(md, 'What it makes')), metadataSource: 'live install.md and page copy prompt' };
}

// Fixed-origin, bounded GETs only. No product URLs, jobs, analytics, account calls or persistent runtime cache.
export async function publicGet(url, { fetchImpl = fetch, timeoutMs = 4000 } = {}) {
  if (!(url === LLMS || /^https:\/\/omnigami\.ai\/skills\/[a-z0-9-]+(?:\/install\.md)?$/.test(url))) throw new Error('Not a public catalogue URL');
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error', credentials: 'omit',
    headers: { Accept: 'text/plain, text/markdown, text/html' } });
  if (!res.ok) throw new Error(`Public catalogue HTTP ${res.status}`);
  const reader = res.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_500_000) throw new Error('Public page too large');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export class Catalogue {
  constructor(snapshot, { offline = false, fetchImpl = fetch, ttlMs = 15 * 60_000 } = {}) {
    if (snapshot.schemaVersion !== 1 || !snapshot.skills?.length) throw new Error('Unsupported bundled catalogue');
    this.snapshot = snapshot; this.offline = offline; this.fetchImpl = fetchImpl; this.ttlMs = ttlMs;
    this.details = new Map();
  }
  static async open(options) {
    // Same relative path in source and build.
    const snapshot = JSON.parse(await readFile(new URL('../data/catalogue.json', import.meta.url), 'utf8'));
    return new Catalogue(snapshot, options);
  }
  async list() {
    if (this.current && Date.now() - this.loadedAt < this.ttlMs) return this.current;
    if (this.pending) return this.pending;
    this.pending = this.load();
    try { return await this.pending; } finally { this.pending = null; }
  }
  async load() {
    this.details.clear();
    let skills = this.snapshot.skills, tools = this.snapshot.tools, source = 'snapshot';
    const notes = [];
    if (!this.offline) {
      try {
        const text = await publicGet(LLMS, this);
        skills = parseTable(text, this.snapshot); tools = parseTools(text); source = 'live';
      }
      catch { notes.push('The live catalogue was unreachable or its format changed.'); }
    }
    if (source === 'snapshot') notes.push(`From omnigami's catalogue as of ${this.snapshot.generated}; confirm availability and price on the skill page before buying or installing.`);
    if (source === 'live') {
      const before = this.snapshot.skills.map(({ slug, name, free, price, makes, install }) => ({ slug, name, free, price, makes, install }));
      const after = skills.map(({ slug, name, free, price, makes, install }) => ({ slug, name, free, price, makes, install }));
      if (JSON.stringify(before) !== JSON.stringify(after)) notes.push(`The bundled catalogue dated ${this.snapshot.generated} was older; I used the live list instead.`);
    }
    this.loadedAt = Date.now();
    this.current = { skills, tools, contact: this.snapshot.contact,
      catalogue: { source, url: LLMS, snapshot_date: this.snapshot.generated, checked_at: source === 'live' ? new Date().toISOString() : null, notes } };
    return this.current;
  }
  async get(slug) {
    if (!validSlug(slug)) throw new Error('Invalid skill slug');
    const data = await this.list();
    const row = data.skills.find((s) => s.slug === slug);
    if (!row) return null;
    if (this.details.has(slug)) return this.details.get(slug);
    const pending = (async () => {
      if (data.catalogue.source === 'live') {
        try {
          const [md, html] = await Promise.all([publicGet(row.installMd, this), publicGet(row.page, this)]);
          return { ...parseDetails(md, html, row), details_source: 'live', notes: [] };
        } catch { /* Treat a format change just like an offline detail page. */ }
      }
      const bundled = this.snapshot.skills.find((s) => s.slug === slug);
      return { ...row, request: bundled?.request ?? null, platforms: bundled?.platforms ?? [], details_source: 'snapshot',
        notes: [`Details and copy prompt are from ${this.snapshot.generated}; confirm at ${row.page} before installing.`] };
    })();
    this.details.set(slug, pending);
    return pending;
  }
}
