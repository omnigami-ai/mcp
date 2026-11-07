const normalize = (s) => s.normalize('NFKD').replace(/[’']/g, '').toLowerCase();
const stop = new Set('a an the for my our your i we to of from and or with on in it app product make need want me please skill skills video film'.split(' '));
export const words = (s) => [...new Set(normalize(s).match(/[a-z0-9]+/g) ?? [])].filter((s) => !stop.has(s));

// Distinctions in the finder SKILL.md, not commercial boosts. Specific jobs precede broad launch matches.
export function intentOf(job) {
  const j = normalize(job).replace(/\b(?:i |we )?(?:already )?(?:own|bought|have access to)\b[^.!?\n]*(?:[.!?]|$)/gi, ' ');
  if (/\b(recording|footage|mp4)\b/.test(j) && /\b(only|exact|preserv|no app)/.test(j)) return 'recording';
  if (/\b(app store|play store|store listing)\b/.test(j) && /\b(screenshot|screenshots|stills|images)\b/.test(j) && !/not (?:a )?(?:screenshot|still)/.test(j)) return 'store-images';
  if (/\b(app store|store cut|store preview)\b/.test(j)) return 'store-video';
  if (/fundrais|investor|seed round|\bpitch deck\b/.test(j) && !/not (?:a )?fundrais|no investor/.test(j)) return 'investor';
  if (/leave.behind|read and forward|no presenter|self.read|without a presenter|sent to read|\bsales deck\b/.test(j)) return 'sales';
  if (/deck|slides|presentation|present .*live/.test(j)) return /sales pitch/.test(j) ? 'sales' : 'presenter';
  if (/mockup|device artwork|device still|phone pair|photoreal (?:laptop|phone)/.test(j) && !/video|film|recording/.test(j)) return /dark|screen.lit|black space/.test(j) && !/no dark/.test(j) ? 'dark-mockups' : 'light-mockups';
  if (/\b(one|single|just one)\b/.test(j) && /link.preview|share image|og image|social image/.test(j)) return 'one-image';
  if (/screenshot set|store screenshots/.test(j)) return 'store-images';
  if (/release|changelog|whats new|version announcement/.test(j)) return 'release';
  if (/morph|one container|continuous container/.test(j)) return 'morph';
  if (/campaign|carousel/.test(j)) return 'campaign';
  if (/share cards|per.page|every page|og images/.test(j)) return 'share-cards';
  if (/flow diagram|workflow diagram|diagram/.test(j)) return 'diagram';
  if (/\b(terminal|cli)\b/.test(j)) return 'terminal';
  if (/\b(end card|closing scene)\b/.test(j)) return 'end-card';
  if (/cursor|camera/.test(j) && /scene|shot/.test(j)) return 'cursor-camera';
  if (/\b(launch|introduc|promo|website hero)\b/.test(j)) return 'launch';
  return null;
}
export const preferred = {
  'store-images': 'app-store-screenshots', 'store-video': 'app-store-preview', investor: 'pitch-deck', sales: 'sales-deck',
  presenter: 'product-deck', 'dark-mockups': 'screen-lit-mockups', 'light-mockups': 'device-mockups', release: 'whats-new',
  morph: 'ui-morph', campaign: 'launch-kit', 'share-cards': 'share-cards', diagram: 'flow-diagram', terminal: 'terminal-film',
  'end-card': 'end-card', 'cursor-camera': 'cursor-camera', launch: 'product-film',
};
export function searchSkills(skills, query, { kind, free, limit = 8 } = {}) {
  const terms = words(query), q = normalize(query).trim(), intent = intentOf(query);
  if (!terms.length && !intent && !skills.some((s) => q === normalize(s.name) || q === s.slug)) return [];
  return skills.filter((s) => (!kind || s.kind === kind) && (free === undefined || s.free === free)).map((s) => {
    const name = normalize(`${s.name} ${s.slug.replaceAll('-', ' ')}`);
    const makes = normalize(s.makes);
    const body = normalize([s.tagline, s.lede, ...(s.goodFor ?? []), ...(s.jobs ?? [])].join(' '));
    let score = terms.reduce((n, w) => n + (name.includes(w) ? 7 : makes.includes(w) ? 4 : body.includes(w) ? 1 : 0), 0);
    if (q === normalize(s.name) || q === s.slug) score += 100;
    if (preferred[intent] === s.slug) score += 60;
    return { skill: s, score };
  }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score || Number(b.skill.free) - Number(a.skill.free) || a.skill.slug.localeCompare(b.skill.slug))
    .slice(0, limit).map(({ skill }) => skill);
}
export function summary(s) {
  return { slug: s.slug, name: s.name, kind: s.kind, one_line: s.tagline, makes: s.makes,
    free: s.free, price_usd: s.free ? 0 : s.price, page_url: s.page };
}
