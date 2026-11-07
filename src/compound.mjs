import { intentOf, preferred } from './search.mjs';

// Identify separately requested outputs before the single-job router picks one.
// Shapes, export formats and source screenshots are not additional deliverables.
export function compoundChoices(job, skills) {
  const clauses = job.replace(/\b(?:I |we )?(?:already )?(?:own|bought|have access to)\b[^.!?\n]*(?:[.!?]|$)/gi, ' ')
    .split(/\b(?:and|plus|also|as well as)\b|[&;\n]|[.!?](?=\s|$)|,(?=\s*(?:(?:an?|the)\s+)?(?:investor|sales|product|app store|launch|a set|share|screen-lit|device))/i);
  const choices = new Map();
  for (let clause of clauses) {
    if (/^\s*(?:use|choose|chosen|there (?:is|are) no)\b/i.test(clause)) continue;
    if (/\b(?:not|instead of|rather than)\s+(?:an?\s+|the\s+)?[^.!?]*\b(?:decks?|films?|videos?|screenshot sets?)\b/i.test(clause)
        && !/\b(?:make|create|need|want|build|produce)\b.*\b(?:not|instead of|rather than)\b/i.test(clause)) continue;
    clause = clause.replace(/\b(?:not|without|no|instead of|rather than)\s+(?:an?\s+|the\s+)?(?:(?:investor|sales|product|launch|app store)\s+)?(?:screenshot sets?|screenshots?|decks?|presentations?|slides|films?|videos?|mockups?)\b/gi, '');
    // Inputs and destinations can mention an output without asking us to make it.
    if (/^\s*(?:from|using|with|for|into)\b/i.test(clause)) continue;
    if (!/\b(?:films?|videos?|clips?|decks?|slides|presentations?|screenshots?|mockups?|share cards|og images|carousels?|campaign(?: stills| kit)?|(?:flow|workflow) diagrams?|end cards?|closing scenes?)\b/i.test(clause)) continue;
    if (/\b(?:from|using|with|have|supplied)\s+(?:only\s+)?(?:my\s+|our\s+|the\s+)?(?:screenshots?|slides|captures)\b/i.test(clause)
        && !/\b(?:make|create|need|want|build|produce)\b/i.test(clause)) continue;
    // Store and matching social cuts are the one App Store preview deliverable.
    const intent = choices.has('app-store-preview') && /\bmatching\b.*\bsocial video\b/i.test(clause)
      ? 'store-video' : intentOf(clause) ?? (/\b(?:video|film)s?\b/i.test(clause) ? 'launch' : null);
    const slug = preferred[intent];
    if (!slug) continue;
    const skill = skills.find((s) => s.slug === slug);
    choices.set(slug, { slug, name: skill?.name ?? slug.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join(' ') });
  }
  return choices.size > 1 ? [...choices.values()] : [];
}
