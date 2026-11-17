import { z } from 'zod';
import { McpError, ErrorCode, SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';
import { EXTENSION, SkillParamsError } from './skills.mjs';

export const MODERN = '2026-07-28';
const envelope = (data) => ({ resultType: 'complete', ttlMs: 0, cacheScope: 'public', ...data });
const request = (method, fields = {}) => z.object({ method: z.literal(method), params: z.object({
  _meta: z.record(z.string(), z.unknown()).optional(), ...fields,
}).optional() });

export function attachSkills(server, skills) {
  const low = server.server;
  low.registerCapabilities({ resources: {}, extensions: { [EXTENSION]: {} } });
  const handle = (method, fields, run) => low.setRequestHandler(request(method, fields), async ({ params = {} }) => {
    try { return envelope(await run(params)); }
    catch (err) { throw new McpError(err instanceof SkillParamsError ? ErrorCode.InvalidParams : ErrorCode.InternalError, err.message); }
  });
  handle('server/discover', {}, async () => ({ supportedVersions: [MODERN, '2025-11-25'], capabilities: low.getCapabilities(),
    instructions: 'Experimental complete free skills. Oversized manifests are labelled. Retrieval is not activation; the host controls consent and execution.' }));
  handle('skills/list', { cursor: z.string().optional() }, ({ cursor }) => skills.list(cursor));
  handle('skills/get', { uri: z.string() }, ({ uri }) => skills.get(uri));
  handle('resources/read', { uri: z.string() }, ({ uri }) => skills.read(uri));
  // Discovery is via skills/list. Ordinary resource discovery remains harmless for older clients.
  handle('resources/list', {}, async () => ({ resources: [] }));
  handle('resources/templates/list', {}, async () => ({ resourceTemplates: [] }));
}

// SDK 1.32.2 has custom handlers but no Skills helper or 2026 stateless codec.
// This small transport adapter supplies that revision for this server's read-only surface,
// while preserving initialize and the existing tool wire format for older clients.
export class SkillsTransport {
  constructor(inner) { this.inner = inner; this.modern = new Set(); }
  async start() {
    this.inner.onmessage = (message, extra) => {
      if (message.method === 'initialize') this.legacy = true;
      if (message.method && message.id !== undefined && message.method !== 'initialize') {
        const meta = message.params?._meta;
        const version = meta?.['io.modelcontextprotocol/protocolVersion'];
        const legacyMetadata = this.legacy && message.method !== 'server/discover' && SUPPORTED_PROTOCOL_VERSIONS.includes(version);
        if (!legacyMetadata && (version !== undefined || message.method === 'server/discover' || !this.legacy)) {
          if (version !== undefined && version !== MODERN) {
            void this.inner.send({ jsonrpc: '2.0', id: message.id, error: { code: -32022,
              message: 'Unsupported protocol version', data: { supportedVersions: [MODERN, '2025-11-25'] } } });
            return;
          }
          if (version !== MODERN || !meta || typeof meta['io.modelcontextprotocol/clientCapabilities'] !== 'object'
            || !meta['io.modelcontextprotocol/clientCapabilities'] || Array.isArray(meta['io.modelcontextprotocol/clientCapabilities'])) {
            void this.inner.send({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Use protocol 2026-07-28 and per-request clientCapabilities metadata' } });
            return;
          }
          this.modern.add(message.id);
        }
      }
      this.onmessage?.(message, extra);
    };
    this.inner.onerror = (err) => this.onerror?.(err);
    this.inner.onclose = () => this.onclose?.();
    await this.inner.start();
  }
  async send(message, options) {
    if (this.modern.delete(message.id) && message.result) message = { ...message, result: envelope(message.result) };
    return this.inner.send(message, options);
  }
  async close() { return this.inner.close(); }
}
