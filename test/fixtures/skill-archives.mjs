import tar from 'tar-stream';
import { gzipSync } from 'node:zlib';
import { digest, LIMITS } from '../../src/skills.mjs';

export async function archive(entries) {
  const pack = tar.pack(), chunks = [];
  const collect = (async () => { for await (const chunk of pack) chunks.push(chunk); })();
  for (const [header, bytes = Buffer.alloc(0)] of entries) {
    await new Promise((resolve, reject) => pack.entry(header, bytes, (err) => err ? reject(err) : resolve()));
  }
  pack.finalize(); await collect;
  return gzipSync(Buffer.concat(chunks));
}
export const name = 'sample';
export const description = 'Exercise complete skill delivery.';
export const skillText = Buffer.from(`---\nname: ${name}\ndescription: ${description}\nmetadata:\n  sample: true\n---\n\n# Sample\nRead assets/data.bin.\n`);
export async function fixture(kind = 'good') {
  const entries = [[{ name: 'SKILL.md' }, skillText], [{ name: 'assets/data.bin' }, Buffer.from([0, 255, 128, 10])],
    [{ name: 'references/a b.md' }, Buffer.from('Some text\n')]];
  if (kind === 'traversal') entries.push([{ name: '../escape' }, Buffer.from('x')]);
  if (kind === 'oversize') entries.push([{ name: 'huge.bin' }, Buffer.alloc(LIMITS.bytes + 1)]);
  const bytes = await archive(entries);
  const hash = kind === 'tampered' ? `sha256:${'0'.repeat(64)}` : digest(bytes);
  const row = { name, type: 'archive', description, digest: hash, url: `https://media.omnigami.ai/m/skills/${name}-${hash.slice(7, 23)}.tar.gz` };
  return { bytes, row, index: JSON.stringify({ skills: [row] }), entries };
}
