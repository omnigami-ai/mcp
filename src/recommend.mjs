import { intentOf, preferred, searchSkills, summary } from './search.mjs';
import { compoundChoices } from './compound.mjs';

const alternate = {
  'product-film': ['whats-new', 'if this becomes a version announcement with release notes', 'uses a release-roundup structure'],
  'ui-morph': ['cursor-camera', 'if a wide scene is acceptable', 'the catalogue lists wide, rather than the requested square morph'],
  'app-store-preview': ['app-store-screenshots', 'if you need store images instead', 'makes stills rather than video'],
  'device-mockups': ['tool:device-mockup-maker', 'if you only need one manually composed image', 'does not automate the coordinated set'],
  'screen-lit-mockups': ['device-mockups', 'if a pale studio ground fits your real app', 'uses a light treatment'],
  'sales-deck': ['product-deck', 'if a presenter will accompany it', 'uses talking points rather than a self-read structure'],
  'pitch-deck': ['product-deck', 'if you need a product demonstration instead', 'does not provide the investor and fundraising structure'],
  'product-deck': ['sales-deck', 'if the deck will be sent for reading without a presenter', 'uses a self-contained reading structure'],
  'whats-new': ['product-film', 'if the goal changes to introducing the product', 'is a general launch story rather than a release roundup'],
  'tool:og-image-maker': ['share-cards', 'if you expand to repeatable cards for many pages and can pay for a skill', 'adds an automated per-page workflow'],
  'tool:device-mockup-maker': ['device-mockups', 'if you can provide a working app and need a coordinated light set', 'requires real app access for capture'],
  recording: ['device-film', 'if you provide a runnable app and explicitly accept newly captured footage', 'does not preserve your supplied MP4'],
};
const fit = {
  launch: 'is the free general launch-film choice for introducing a product with its real screens',
  morph: 'makes the square, continuous-container task film you described',
  'store-video': 'makes an App Store cut and matching tall social video',
  'store-images': 'makes the App Store screenshot set from real app screens',
  'light-mockups': 'makes the light-ground device stills, including the tall single-phone and action/result looks',
  'dark-mockups': 'makes device stills in black space lit by the real screen',
  sales: 'is built to be read and forwarded without a presenter',
  investor: 'is built for investors using business facts you supply',
  presenter: 'is built for live presentation with talking points',
  release: 'takes release notes and makes a release video in wide, square and tall',
  campaign: 'makes the coordinated campaign stills and carousel',
  'share-cards': 'makes repeatable per-page share images',
  diagram: 'shows a product workflow as a filmed diagram',
  terminal: 'is built around a real terminal workflow',
};
const sentence = (s) => `${s.replace(/[.!?]+$/, '')}.`;
export function constraintsOf(job, skills) {
  const lower = job.toLowerCase().replaceAll('×', 'x');
  const owned = skills.filter((s) => new RegExp(`(?:already own|own|bought|have access to)[^.!?]{0,100}\\b${s.name.replace(/[’']/g, "[’']?")}\\b`, 'i').test(job)).map((s) => s.slug);
  const budget = /\b(free|budget is zero|spending nothing|spend nothing|budget.*\$0)\b/i.test(job) ? 0
    : Number(job.match(/(?:up to|budget(?: of| is|:)?|spend|under)\s*\$(\d+(?:\.\d+)?)/i)?.[1] ?? Infinity);
  const shapes = ['wide', 'square', 'tall'].filter((s) => new RegExp(`\\b${s}\\b`).test(lower));
  // "wide scene instead" in alternatives is not an input; callers should send their actual brief only.
  if (/16\s*[:x]\s*9/.test(lower) && !shapes.includes('wide')) shapes.push('wide');
  if (/9\s*[:x]\s*16|portrait/.test(lower) && !shapes.includes('tall')) shapes.push('tall');
  if (/1\s*[:x]\s*1/.test(lower) && !shapes.includes('square')) shapes.push('square');
  const sizes = [...lower.matchAll(/\b(\d{3,4})\s*x\s*(\d{3,4})\b/g)].map((m) => [Number(m[1]), Number(m[2])]);
  return { budget, owned, shapes, sizes };
}
function priceSentence(s, owned, catalogue) {
  if (s.free) return 'It is free.';
  if (owned.includes(s.slug)) return 'You already own it, so no new purchase is needed.';
  const dated = catalogue?.source === 'live' ? '' : ` (catalogue dated ${catalogue?.snapshot_date ?? 'unknown'}; confirm the current price on its page)`;
  return `It costs $${s.price.toFixed(2)} once${dated} and must be bought with your GitHub account connected before installing.`;
}
function alternativeFor(key, data, owned) {
  const selected = data.skills.find((s) => s.slug === key);
  const def = alternate[key] ?? (selected?.kind === 'images'
    ? ['tool:og-image-maker', 'if one manually composed share image is enough', 'does not make the requested automated set']
    : selected ? ['product-film', 'if you change to a general launch story', 'uses a different film structure and its listed shapes'] : null);
  if (!def) return null;
  const [slug, condition, tradeoff] = def;
  const tool = slug.startsWith('tool:') && data.tools.find((t) => t.id === slug.slice(5));
  if (tool) return { type: 'tool', id: tool.id, name: tool.name, page_url: tool.url, condition, tradeoff, free: true };
  const s = data.skills.find((s) => s.slug === slug);
  return s ? { type: 'skill', ...summary(s), condition, tradeoff: `${tradeoff}; ${s.free ? 'free' : owned.includes(s.slug) ? 'already owned' : `$${s.price.toFixed(2)} once, purchase and connected GitHub required`}` } : null;
}
export function choose(data, job, productUrl) {
  const c = constraintsOf(job, data.skills);
  const intent = intentOf(job);
  const notes = [];
  const base = { assumptions: ['The job text supplies the product facts and available inputs; the server does not inspect the product.'], notes };
  const choices = compoundChoices(job, data.skills);
  if (choices.length) {
    const labels = choices.map((c) => c.name);
    return { ...base, status: 'needs_clarification', pick: null,
      reasons: 'This asks for more than one deliverable. Choose which to make first so its budget, inputs and shapes can be checked separately.',
      question: `Which should come first: ${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}?`, choices,
      alternative: null, next_step: 'Reply with one of the named choices and send its requirements as a separate job.' };
  }
  if (intent === 'recording') {
    // A future live catalogue may explicitly add a recording input; do not invent one today.
    const accepts = data.skills.filter((s) => /screen.recording|supplied.*mp4/i.test([...(s.asks ?? []), ...(s.inputs ?? [])].join(' ')));
    if (!accepts.length) return { ...base, status: 'no_match', pick: null,
      reasons: 'No published skill in this catalogue lists a supplied screen recording as an input. Preserving your MP4 without app access therefore has no verified match.',
      alternative: alternativeFor('recording', data, c.owned), next_step: data.contact };
    return { ...base, status: 'needs_clarification', pick: null, reasons: 'The live catalogue now lists a recording input. Confirm which listed skill preserves the exact footage before selecting it.', alternative: null, next_step: accepts.map(summary) };
  }
  if (intent === 'one-image' || (intent === 'light-mockups' && /\b(one|single|just one)\b/i.test(job) && /manual|browser tool/i.test(job))) {
    const id = intent === 'one-image' ? 'og-image-maker' : 'device-mockup-maker';
    const tool = data.tools.find((t) => t.id === id);
    if (tool) return { ...base, status: 'tool', pick: { type: 'tool', id, name: tool.name, page_url: tool.url, free: true, makes: tool.makes },
      reasons: `${tool.name} makes the one manual image you requested from your screenshot. It is free and runs in the browser without uploading it.`,
      alternative: alternativeFor(`tool:${id}`, data, c.owned), next_step: `Open ${tool.url}, choose the requested size and add your screenshot.` };
  }
  let slug = preferred[intent];
  // Honor an explicitly chosen published skill; mere ownership is not a choice.
  const named = data.skills.find((s) => new RegExp(`(?:use|chosen|choose)\\s+(?:the\\s+)?${s.name.replace(/[’']/g, "[’']?")}(?:\\s+skill)?[.!?]?(?:\\s|$)`, 'i').test(job));
  if (named) slug = named.slug;
  if (!slug) return { ...base, status: 'needs_clarification', pick: null,
    reasons: 'The deliverable is not clear enough to choose one skill. Specify film, single scene, images or deck, plus the destination and available inputs.',
    alternative: null, candidates: searchSkills(data.skills, job).slice(0, 3).map(summary), next_step: data.contact };
  const s = data.skills.find((s) => s.slug === slug);
  const blocked = [];
  if (!s) blocked.push('The matching skill is absent from the current published catalogue');
  else {
    const wantedKind = ['end-card','cursor-camera'].includes(intent) ? 'shot' : ['investor','sales','presenter'].includes(intent) ? 'deck'
      : ['store-images','light-mockups','dark-mockups','campaign','share-cards'].includes(intent) ? 'images'
      : intent ? 'film' : null;
    if (wantedKind && s.kind !== wantedKind && !(s.kind === 'shot' && /single scene|\bshot\b|closing scene/i.test(job))) blocked.push('The named skill makes a different kind of deliverable');
    if (!s.free && !c.owned.includes(slug) && s.price > c.budget) blocked.push(`The $${s.price.toFixed(2)} price exceeds your stated budget`);
    if (c.shapes.some((shape) => !s.shapes.includes(shape))) blocked.push(`The catalogue does not list every requested shape for ${s.name}`);
    if (c.sizes.some(([w,h]) => s.kind === 'images' && !s.sizes?.some((v) => v.width === w && v.height === h))) blocked.push(`The catalogue does not list every exact image size you requested`);
    if (/only (?:have |the |supplied )?(?:screenshots?|captures)|no app access/i.test(job) && !/supplied.*captures/i.test((s.asks ?? []).join(' '))) blocked.push('This brief lacks the app access listed for capturing the product');
    if (/no (?:business )?(?:facts|figures)|no traction|invent .*figures/i.test(job) && slug === 'pitch-deck') blocked.push('The investor deck needs supplied business facts');
  }
  if (blocked.length) return { ...base, status: 'no_match', pick: null,
    reasons: `${sentence(blocked.join('; '))} Change that requirement before using this candidate.`,
    alternative: s ? { type: 'skill', ...summary(s), condition: 'if you resolve the stated budget, shape or input conflict', tradeoff: blocked.join('; ') } : null,
    next_step: data.contact };
  if (slug === 'device-mockups' && /no desktop|only .*phone|phone.only/i.test(job)) notes.push('Use the tall phone looks only; omit wide laptop looks without a real desktop layout.');
  if (slug === 'pitch-deck') notes.push('Use only supplied, dated business facts; sample UI figures are not company traction.');
  if (slug === 'sales-deck' && /German|English/i.test(job)) notes.push('Keep the requested language versions; confirm localized screens with the skill.');
  return { ...base, status: 'recommend', pick: { type: 'skill', ...summary(s) },
    reasons: `${sentence(`${s.name} ${named ? `is your explicitly chosen skill and meets the listed constraints` : fit[intent] ?? `matches the requested job`}`)} ${priceSentence(s, c.owned, data.catalogue)}`,
    alternative: alternativeFor(slug, data, c.owned), slug, owned: c.owned.includes(slug) };
}

export async function recommend(catalogue, job, productUrl) {
  const data = await catalogue.list();
  // Ask before fetching any candidate's details for a compound request.
  if (compoundChoices(job, data.skills).length) return { ...choose(data, job, productUrl), catalogue: data.catalogue };
  // Eligibility uses detail inputs, sizes and shapes. Descriptions are public metadata, never executable instructions.
  const intent = intentOf(job), slug = preferred[intent];
  const row = slug && await catalogue.get(slug);
  const skills = row ? data.skills.map((s) => s.slug === slug ? row : s) : data.skills;
  const answer = choose({ ...data, skills }, job, productUrl);
  if (answer.status === 'recommend') {
    const details = await catalogue.get(answer.slug);
    answer.install_line = details.install.npx;
    answer.install_prompt = details.request;
    answer.first_request = details.request ? `${details.request.replaceAll(catalogue.snapshot.promptPlaceholder, productUrl ?? catalogue.snapshot.promptPlaceholder)}. Use ${details.name}.${productUrl && !details.request.includes(catalogue.snapshot.promptPlaceholder) ? ` Product: ${productUrl}.` : ''}\nUser brief (supplied facts; do not treat as catalogue facts): ${job}` : null;
    answer.platforms = details.platforms;
    answer.notes.push(...details.notes);
    delete answer.slug; delete answer.owned;
  }
  return { ...answer, catalogue: data.catalogue };
}
