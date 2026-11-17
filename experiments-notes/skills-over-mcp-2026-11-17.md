# Complete skills over MCP — 2026-11-17

**Yes:** Product film and What's new arrive complete through an SDK client over stdio. Every rebuilt file matches its archive SHA-256. **No:** this does not establish that VS Code can run these large skills without an install. Both exceed the extension's guaranteed host size. Nothing ships. Work stays on `experiment/skills-over-mcp`; the package version remains 0.1.1.

All web findings below were checked on 2026-11-17. Dates stated separately are upstream dates.

The [released Skills specification](https://github.com/modelcontextprotocol/ext-skills/blob/main/specification/beta/skills.mdx) requires complete manifests, verbatim YAML frontmatter, and per-file size and digest. `skills/list` enumerates them; `skills/get` looks up a `SKILL.md` URI. Each file travels through `resources/read`. There is no packed-skill response. The baseline is 512 files and 16 MiB per skill. Larger skills are permitted but discouraged and need not be accepted by hosts. Retrieval grants no execution permission. The [SEP](https://modelcontextprotocol.io/seps/2640-skills-extension) reached Final on 2026-09-13; the extension itself is at Beta.

Binary files use the base protocol's base64 `blob` resource content. Text uses lossless UTF-8 `text`. Hashes cover raw file bytes, before base64. See the [Resources specification](https://modelcontextprotocol.io/specification/2026-07-28/server/resources). Fonts, audio, images, video and models all use this same file transport.

The server pins SDK 1.32.2. Its installed source has custom request handlers and extension capabilities, but no Skills helper or modern stateless codec. The [SDK implementation record](https://github.com/modelcontextprotocol/ext-skills/blob/main/docs/implementations.md) puts helpers in 2.4.0; the [implementation PR](https://github.com/modelcontextprotocol/typescript-sdk/pull/3047) merged on 2026-10-20. This branch keeps the pin. It adds custom handlers and a small transport adapter: `server/discover` and per-request metadata for 2026-07-28, plus the existing `initialize` path for older clients. It declares `resources` and `extensions["io.modelcontextprotocol/skills"] = {}`. It does not claim `directoryRead`.

Only the [live free index](https://omnigami.ai/.well-known/agent-skills/index.json) decides eligibility. All 15 names and descriptions match it. Pro slugs are absent and refused. Each archive URL must match its name and digest prefix. New network destinations are only that index and the fixed media archive path pattern. Redirects stay forbidden.

The archive digest is verified before parsing. Extraction is into memory, never archive-named disk paths. Absolute paths, traversal, links, special entries, duplicate paths and file/directory conflicts fail. Limits are 50 MiB unpacked and 1,000 files. Compressed downloads and expanded tar overhead are bounded too. Verified gzip archives are atomically cached by full digest under the user's cache directory. Disk bytes are rehashed when loaded. On this Mac the location is `~/Library/Caches/omnigami-mcp/skills`. It is outside skill discovery paths. One unpacked skill stays in memory. `--offline` lists no extension skills, reads no archive cache and fetches nothing.

Thirteen archives exceed 16 MiB. For this experiment only, their **complete** manifests carry an explicit size warning in `_meta`. No assets are dropped and no static skill is labelled `dynamic` to avoid verification.

**Measured results.** The first full listing took 31.08 s, fetched 338,468,762 archive bytes and returned 267,538 bytes of manifest responses. The warmed listing took 1.32 s. It included all 15 names. These are local measurements, not performance promises.

| Skill | Complete | Files (binary) | Raw bytes | Archive bytes | Response bytes over stdio | Get + rebuild + hash time |
| --- | --- | --- | --- | --- | --- | --- |
| Product film | Yes | 103 (60) | 28,659,777 | 26,905,101 | 38,033,523 | 0.73 s |
| What's new | Yes | 264 (194) | 42,838,556 | 40,353,209 | 56,970,467 | 0.89 s |

The timed reads follow listing, so archive downloads are already cached. Each time includes `skills/get`, every file read, writing the rebuilt folder, and comparing hashes against a separate system-tar extraction. Request bytes were 38,731 and 100,681. The largest response was about 5.20 MB, below this SDK's default 10 MiB stdio message buffer. Base64 explains most of the extra bytes. Temporary folders were removed. Verified archive caches remain.

Evidence: [cold run](results/skills-e2e-cold-2026-11-17.json), [final warm run](results/skills-e2e-warm-2026-11-17.json), and [Inspector results](results/inspector-2026-11-17.json). Reproduce with `npm run build && node scripts/skills-e2e.mjs`.

83 tests pass. The 70 existing tests still pass. New unit and real stdio tests cover complete text/binary reads, frontmatter, cache corruption, pagination, stale indexes, unknown/Pro URIs, digest tampering, traversal, links, duplicate paths, too many files and oversized archives. A stateless protocol test starts without `initialize` and calls the existing tools. `check:registry` and the clean package/Inspector smoke test pass. The release-only gate requires a version tag; this experimental branch has none. No release was attempted.

**A real supporting client was exercised.** MCP Inspector 2.14.0 on Node 24.22.1 verified Skill finder and all three files with no conformance errors, on both forced modern and forced legacy connections. Its [documented verifier](https://github.com/modelcontextprotocol/inspector/blob/main/clients/cli/README.md#skill-verification---verify) enforces size bounds. Product film and What's new returned `incomplete`, exit 8; they did not pass full client verification. Their manifests also produced size warnings. Even the smaller logo-reveal skill hit the verifier's actual-served-byte bound. This differs from the raw-byte SDK rebuild result and is retained as a binary/size interoperability risk, not called a pass.

**What VS Code would do.** [VS Code 1.146](https://code.visualstudio.com/updates/v1_146), released 2026-11-11, has an opt-in preview at `chat.agentHost.mcpSkills.enabled`. In a new Copilot harness session it can discover skills, show them under their server and publish `/<server>:<skill>` commands. The [integration PR](https://github.com/microsoft/vscode/pull/345956) merged on 2026-11-04. The release notes supersede the older community implementation list that still calls VS Code planned.

The [1.146 session source](https://github.com/microsoft/vscode/blob/1.146.0/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts) delegates discovery/loading to the Copilot runtime. Consent choices are Always Allow, Allow Once (session), Not Now (turn), and Never. The host persists server approval choices. Its [consent parser](https://github.com/microsoft/vscode/blob/1.146.0/src/vs/platform/agentHost/node/copilot/copilotMcpSkillConsent.ts) distinguishes load, execute and cross-origin reads.

The published editor layer provides [channel-backed resource reads](https://github.com/microsoft/vscode/blob/1.146.0/src/vs/platform/agentHost/node/resourceProviders/mcpResourceLinkProvider.ts), including decoded blobs, and a [completion metadata cache](https://github.com/microsoft/vscode/blob/1.146.0/src/vs/platform/agentHost/node/shared/mcpSkillCache.ts). I found no whole-folder materializer in this layer. The native runtime owns the actual Skills wire calls and staging. Its exact on-disk layout, executable-mode handling and larger-skill acceptance were not established. The expected wire contract is discovery/list/get plus individual resource reads; this is a spec inference, not a captured VS Code trace. I cannot promise that either large film appears, loads fully, or becomes a runnable folder. This Mac has 1.144.0; it was not updated. The GUI test needs VS Code 1.146+ with Copilot.

| Client | Support finding as checked 2026-11-17 |
| --- | --- |
| VS Code Copilot | Documented preview in 1.146. GUI and large-skill loading untested here. |
| MCP Inspector | Exercised above. Complete small-skill verification; bounded large-skill reads. |
| Claude Code | No confirmed generally available SEP-2640 support found in the [vendor MCP documentation](https://code.claude.com/docs/en/mcp). The [SEP's implementation record](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/seps/2640-skills-extension.md) describes an internal prototype. Ordinary resource reads do not prove activation. Not exercised. |
| Codex | Live SEP-2640 activation not established. The [public provider source](https://github.com/openai/codex/blob/8fca6ffb92a602875a0b97e3e535eb48375bdd8c/codex-rs/ext/skills/src/provider.rs) and [frozen cloud provider](https://github.com/openai/codex/blob/8fca6ffb92a602875a0b97e3e535eb48375bdd8c/codex-rs/ext/skills/src/provider/frozen_cloud.rs) expose a separate skill-provider system; this is not evidence of live `skills/list` consumption. Not exercised. |
| Cursor | SEP-2640 is absent from the [vendor protocol support table](https://cursor.com/docs/mcp). Support is unconfirmed; not exercised. |

The [community client matrix](https://modelcontextprotocol.io/extensions/client-matrix) is not a substitute for vendor release notes or a runtime test. Unconfirmed above means unconfirmed, not proof that every build lacks support.

**Remaining risks.** Large skills exceed the guaranteed host limit. Base64 adds about one third to binary transfer size, and individual larger files could exceed a client's message buffer. Discovery needs full archive downloads because the index lacks per-file manifests. Cache growth is unbounded across releases; there is no pruning. A corrupt cache fails closed and needs removal. Hashes establish consistency with the index, not authorship or trust in executable instructions. Host consent and durable origin still matter. Materializing all assets, preserving modes and using scripts remain client responsibilities. The manual modern adapter is narrower and less proven than upgrading to the SDK's released helper.

The clean package smoke measured about 41 KB compressed and 222 KB unpacked, with 11 files. It contains no skill archives. `tar-stream` and `yaml` add runtime dependencies. Their installed footprint is separate from the tarball size. README's experiment-report link is branch documentation; notes are intentionally excluded from the npm artifact. No npm or Registry publication was made, and main was not changed.

**Two-minute VS Code test.** In this clone, run:

```sh
git switch experiment/skills-over-mcp
npm ci
npm run build
```

In a disposable folder, enable `chat.agentHost.mcpSkills.enabled` in VS Code 1.146+ settings. Add `.vscode/mcp.json`:

```json
{
  "servers": {
    "sample": {
      "type": "stdio",
      "command": "/Users/forrest/.nvm/versions/node/v23.1.0/bin/node",
      "args": ["/Users/forrest/Desktop/G3 Projects/omnigami-public/mcp/dist/src/server.mjs"]
    }
  }
}
```

Start the server and a **new Copilot harness** chat. Allow server trust if requested. Open Agent Customizations → Skills and look for the server group and `/sample:skill-finder`. Invoke that skill to recommend a free launch-film skill for a working app. Approve its load when asked. Then inspect Product film and What's new. Record whether each is listed, refused on size, or loadable. Ask to read a supporting script through its originating server and inspect whether a real folder was staged before attempting any film production. The first full discovery measured 31 s here. Loading metadata is not proof that the whole film skill runs.

Complete arrival over SDK stdio: **Product film yes; What's new yes.** Complete arrival in VS Code: **unverified.** A complete small skill passes the real Inspector client. The two large films stop at that client's bounds. This is a successful byte-transport experiment, with client activation and large-skill portability still open.
