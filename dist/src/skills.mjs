import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, rm, mkdtemp } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import tar from 'tar-stream';
import { parseDocument } from 'yaml';
import { publicBytes, validSlug, SKILL_INDEX } from './catalogue.mjs';

export const LIMITS = { bytes: 50 * 1024 * 1024, files: 1000 };
export const EXTENSION = 'io.modelcontextprotocol/skills';
export class SkillParamsError extends Error {}
export const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const fileUri = (name, file) => `skill://${name}/${file.split('/').map(encodeURIComponent).join('/')}`;
const cacheRoot = () => path.join(process.platform === 'darwin' ? path.join(homedir(), 'Library/Caches')
  : process.platform === 'win32' ? process.env.LOCALAPPDATA || path.join(homedir(), 'AppData/Local')
    : process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache'), 'omnigami-mcp', 'skills');

export function safePath(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 4096
    && !/[\\\x00-\x1f\x7f:]/.test(name) && !name.startsWith('/')
    && name.split('/').every((s) => s && s !== '.' && s !== '..');
}

export function parseIndex(bytes) {
  const index = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(index.skills) || index.skills.length > 100) throw Error('Invalid free skill index');
  const seen = new Set();
  return index.skills.map((s) => {
    if (!validSlug(s.name) || s.name.length > 64 || seen.has(s.name) || s.type !== 'archive' || s.free === false
      || typeof s.description !== 'string' || !s.description.length || s.description.length > 1024
      || !digestPattern.test(s.digest)
      || s.url !== `https://media.omnigami.ai/m/skills/${s.name}-${s.digest.slice(7, 23)}.tar.gz`) {
      throw Error('Invalid free skill index entry');
    }
    seen.add(s.name);
    return { name: s.name, description: s.description, url: s.url, digest: s.digest };
  });
}

// Extract to memory, never to archive-provided disk paths. The only disk artifact is the verified gzip.
export async function unpack(archive, expectedDigest) {
  if (!digestPattern.test(expectedDigest) || digest(archive) !== expectedDigest) throw Error('Archive digest mismatch');
  if (archive.length > LIMITS.bytes) throw Error('Compressed archive too large');
  const files = new Map(), allPaths = new Set();
  let total = 0, entries = 0, tarBytes = 0;
  const extractor = tar.extract();
  extractor.on('entry', (header, stream, next) => {
    stream.on('error', (err) => extractor.destroy(err));
    const name = header.type === 'directory' ? header.name.replace(/\/$/, '') : header.name;
    const fail = (message) => extractor.destroy(Error(message));
    if (!safePath(name) || allPaths.has(name)) return fail('Unsafe or duplicate archive path');
    allPaths.add(name);
    if (++entries > LIMITS.files * 2) return fail('Too many archive entries');
    if (!['file', 'directory'].includes(header.type)) return fail('Archive links and special entries are forbidden');
    if (!Number.isSafeInteger(header.size) || header.size < 0) return fail('Invalid archive size');
    if (header.type === 'directory' && header.size !== 0) return fail('Invalid directory');
    if (header.type === 'file') {
      if (files.size >= LIMITS.files) return fail('Too many archive files');
      total += header.size;
      if (total > LIMITS.bytes) return fail('Unpacked archive too large');
    }
    const chunks = []; let size = 0;
    stream.on('data', (chunk) => {
      size += chunk.length;
      if (size > header.size) return fail('Archive file too large');
      chunks.push(chunk);
    });
    stream.on('end', () => {
      if (size !== header.size) return fail('Truncated archive file');
      if (header.type === 'file') files.set(name, Buffer.concat(chunks));
      next();
    });
  });
  const bounded = new Transform({ transform(chunk, _encoding, cb) {
    tarBytes += chunk.length;
    cb(tarBytes > LIMITS.bytes + 5 * 1024 * 1024 ? Error('Unpacked tar stream too large') : null, chunk);
  } });
  await pipeline(Readable.from([archive]), createGunzip(), bounded, extractor);
  for (const name of allPaths) {
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) if (files.has(parts.slice(0, i).join('/'))) throw Error('Archive file/directory conflict');
  }
  if (!files.has('SKILL.md')) throw Error('Archive lacks root SKILL.md');
  return files;
}

export function frontmatter(bytes, row) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const yaml = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!yaml || yaml.length > 64000) throw Error('Invalid SKILL.md frontmatter');
  const doc = parseDocument(yaml, { uniqueKeys: true, schema: 'core' });
  if (doc.errors.length) throw Error('Invalid SKILL.md YAML');
  const value = doc.toJS({ maxAliasCount: 0 });
  if (!value || value.name !== row.name || value.description !== row.description) throw Error('Skill frontmatter differs from free index');
  return value;
}

export class Skills {
  constructor({ offline = false, fetchImpl = fetch, cacheDir = cacheRoot(), ttlMs = 15 * 60000 } = {}) {
    Object.assign(this, { offline, fetchImpl, cacheDir, ttlMs });
    this.pending = new Map();
    this.loaded = new Map();
  }
  async index() {
    if (this.offline) return [];
    if (this.rows && Date.now() - this.indexAt < this.ttlMs) return this.rows;
    if (!this.indexPending) this.indexPending = (async () => {
      const rows = parseIndex(await publicBytes(SKILL_INDEX, this));
      this.rows = rows; this.indexAt = Date.now();
      return rows;
    })().finally(() => { this.indexPending = null; });
    return this.indexPending;
  }
  async archive(row) {
    await mkdir(this.cacheDir, { recursive: true, mode: 0o700 });
    const target = path.join(this.cacheDir, `${row.digest.slice(7)}.tar.gz`);
    let cached;
    try {
      const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > LIMITS.bytes) throw Error('Invalid cache file');
        cached = await handle.readFile();
      } finally { await handle.close(); }
    } catch (err) { if (err.code !== 'ENOENT') throw err; }
    if (cached) {
      if (digest(cached) !== row.digest) throw Error('Cached archive digest mismatch; remove the corrupt cache file');
      return cached;
    }
    const bytes = await publicBytes(row.url, { ...this, timeoutMs: 120000 });
    // Fully validate before storing. Rechecked when unpacked by load().
    await unpack(bytes, row.digest);
    const staging = await mkdtemp(path.join(this.cacheDir, '.download-'));
    try {
      const file = path.join(staging, 'archive');
      const handle = await open(file, 'wx', 0o600);
      try { await handle.writeFile(bytes); } finally { await handle.close(); }
      await rename(file, target);
    } finally { await rm(staging, { recursive: true, force: true }); }
    return bytes;
  }
  async load(row) {
    // Keep only one unpacked skill resident, rather than hundreds of MB after a list.
    if (this.loaded.has(row.digest)) return this.loaded.get(row.digest);
    if (this.pending.has(row.digest)) return this.pending.get(row.digest);
    const pending = (async () => {
      const files = await unpack(await this.archive(row), row.digest);
      const entry = { uri: fileUri(row.name, 'SKILL.md'), frontmatter: frontmatter(files.get('SKILL.md'), row),
        resources: [...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => ({ uri: fileUri(row.name, name), digest: digest(bytes), size: bytes.length })) };
      const total = entry.resources.reduce((sum, r) => sum + r.size, 0);
      if (total > 16 * 1024 * 1024 || files.size > 512) entry._meta = {
        'ai.omnigami/experimentalLimits': `Complete skill: ${total} bytes, ${files.size} files; exceeds the extension baseline of 16 MiB/512 files. Client acceptance is not guaranteed.`,
      };
      const loaded = { entry, files };
      this.loaded.clear(); this.loaded.set(row.digest, loaded);
      return loaded;
    })().finally(() => this.pending.delete(row.digest));
    this.pending.set(row.digest, pending);
    return pending;
  }
  async list(cursor) {
    const rows = await this.index();
    let offset = 0;
    if (cursor !== undefined) {
      if (!/^[0-9a-f]{64}:\d+$/.test(cursor)) throw new SkillParamsError('Invalid skills cursor');
      const [hash, n] = cursor.split(':');
      if (hash !== digest(Buffer.from(JSON.stringify(rows))).slice(7)) throw new SkillParamsError('Stale skills cursor');
      offset = Number(n);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= rows.length) throw new SkillParamsError('Invalid skills cursor');
    }
    if (!rows.length) return { skills: [] };
    const { entry } = await this.load(rows[offset]);
    return { skills: [entry], ...(offset + 1 < rows.length ? { nextCursor: `${digest(Buffer.from(JSON.stringify(rows))).slice(7)}:${offset + 1}` } : {}) };
  }
  async resolve(uri, entryOnly = false) {
    const match = typeof uri === 'string' && uri.match(/^skill:\/\/([a-z0-9-]+)\/(.+)$/);
    if (!match || !validSlug(match[1])) throw new SkillParamsError('Invalid skill URI');
    let file;
    try { file = match[2].split('/').map(decodeURIComponent).join('/'); } catch { throw new SkillParamsError('Invalid skill URI'); }
    if (!safePath(file) || fileUri(match[1], file) !== uri || (entryOnly && file !== 'SKILL.md')) throw new SkillParamsError('Invalid skill URI');
    const row = (await this.index()).find((s) => s.name === match[1]);
    if (!row) throw new SkillParamsError('No free indexed skill is served at this URI');
    const loaded = await this.load(row);
    if (!loaded.files.has(file)) throw new SkillParamsError('No skill file is served at this URI');
    return { ...loaded, file };
  }
  async get(uri) { return { skill: (await this.resolve(uri, true)).entry }; }
  async read(uri) {
    const { files, file } = await this.resolve(uri);
    const bytes = files.get(file);
    const textTypes = { md: 'text/markdown', txt: 'text/plain', html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', css: 'text/css', svg: 'image/svg+xml', py: 'text/x-python', sh: 'text/x-shellscript' };
    const binaryTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', mp4: 'video/mp4', glb: 'model/gltf-binary' };
    const ext = path.extname(file).slice(1).toLowerCase();
    // Only lossless UTF-8 gets the text branch. Everything else is a base64 blob.
    let text;
    if (textTypes[ext]) try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* binary */ }
    return { contents: [{ uri, mimeType: textTypes[ext] || binaryTypes[ext] || 'application/octet-stream',
      ...(text !== undefined && Buffer.from(text).equals(bytes) ? { text } : { blob: bytes.toString('base64') }) }] };
  }
}
