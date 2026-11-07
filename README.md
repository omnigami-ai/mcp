# omnigami MCP

Find an omnigami skill from your agent: search the public catalogue, get its
install prompt, or describe the job for a free-first recommendation. Runs locally
over stdio. It never buys, installs or generates a deliverable.

**Release candidate 0.1.0, not yet on npm.** The install lines below work once
`@omnigami-ai/mcp` is published. MIT licensed ([LICENSE](LICENSE)).

## Install — once published

Requires Node 20+ and npm. The package starts with:

```sh
npx -y @omnigami-ai/mcp
```

**Claude Desktop:** merge this into `claude_desktop_config.json` through
Settings → Developer → Edit Config, then restart Desktop:

```json
{
  "mcpServers": {
    "omnigami": {
      "command": "npx",
      "args": ["-y", "@omnigami-ai/mcp"]
    }
  }
}
```

**Claude Code:** add it to the current project's `.mcp.json`:

```sh
claude mcp add --scope project --transport stdio omnigami -- npx -y @omnigami-ai/mcp
claude mcp list
```

**Cursor:** merge the same `mcpServers` JSON into `.cursor/mcp.json` in the
project, then enable the server in Cursor's MCP settings. For a global setup use
`~/.cursor/mcp.json`.

If a GUI cannot find `npx`, use its absolute path. On Windows use `"command":
"cmd"` and `"args": ["/c", "npx", "-y", "@omnigami-ai/mcp"]`.
Add `--offline` after the package name to disable catalogue requests.

The prototype was exercised in Claude Code and Inspector CLI. Desktop and Cursor
configuration follows their official documentation; their GUIs have not been
exercised. A skill's own agent support is separate: catalogue results distinguish
Claude Code's tested status from other listed agents.
[Desktop guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers),
[Claude Code configuration](https://code.claude.com/docs/en/mcp),
[Cursor configuration](https://cursor.com/docs/mcp).

## Tools

| Tool | Inputs | Result |
| --- | --- | --- |
| `search_skills` | `query`, optional `kind` (`film`, `shot`, `images`, `deck`) and boolean `free` | Up to eight matching skills, outputs, USD prices and pages |
| `get_skill` | `slug` | Inputs, requirements, install prompt, install command and agent platforms |
| `recommend` | `job`, optional `product_url` | One pick with reasons and a conditional alternative, a free tool, no match, or a clarification |

For example, ask your agent: “Find a free launch-video skill for my working web
app, wide for our website.” Describe the destination, shapes, input access,
budget, theme and owned skills. A general launch defaults to free Product film.
Paid picks explain the price and purchase/GitHub access requirements. No bundles
are promoted. Two deliverables ask which comes first and name both choices.

Version one uses deterministic English routing. The host should inspect the
user's authorized product material and pass a self-contained brief. The server
does not inspect product URLs, verify screens or infer business facts. Complex
implications and negations still need host judgment. A supplied recording has no
verified match while the published catalogue lists no recording input.

## Public data and privacy

The server reads fixed public paths on `https://omnigami.ai`: `/llms.txt`, each
`/skills/<slug>/install.md`, and the corresponding skill page. It uses the live
list for prices and availability and refreshes details on demand. The cache
lasts 15 minutes in memory. Requests have a four-second timeout and 1.5 MB limit,
reject redirects and send no cookies. Failures fall back to the dated bundled
snapshot with an explicit warning; detail failures are labelled separately.

Free-page prompts come from the site's Copy install prompt. Paid pages omit
that button, so their public install.md Ask line is wrapped in the site's same
prompt format; `prompt_source` identifies this fallback.

The bundle contains 36 public skills, checked on 2026-11-07. No keys, accounts,
analytics or runtime disk cache. Jobs and product URLs are never sent to the
site. `product_url` only fills the returned request. The runtime reads its own
installed modules/data, never the user's product repo or credentials. Your host
client controls its own model usage and conversation storage.

## Develop locally — available now

From this source folder:

```sh
npm ci
npm run build
npm test
npm run check:snapshot
npm run check:registry
node dist/src/server.mjs --offline
```

The server waits for MCP messages on stdin. For an unpublished client setup,
replace the `npx` entry with absolute Node and `dist/src/server.mjs` paths.

`check:snapshot` compares every bundled skill's price, availability, install
command, prompt, inputs and outputs against live public pages. Inside the site
workspace it also compiles the real `site/src/data/skills.ts`, finder helpers
and availability helper. Use `-- --site /path/to/site` explicitly or `-- --live`
for the independent public repository. Network/parse failure fails the check.
`npm run snapshot` refreshes public data; review the diff and rebuild afterward.

CI tests Node 20, 22 and 24 and checks live snapshot freshness. For the clean
tarball install plus Inspector CLI smoke test, use Node 24.22.1+:

```sh
npm run test:pack
```

The script uses a temporary clean export, packs and installs its tarball,
lists the three tools and calls each once, then removes its temporary files.
Inspector 2.14.0 is fetched as a development tool and is absent from the package.
The runtime pins `@modelcontextprotocol/sdk` 1.32.2; the build copies modules and
public data into `dist` without fetching anything.

## Release and contact

Releases are published from version tags by the `release.yml` workflow, with npm
provenance and no stored token. The MCP Registry entry is `publishing/server.json`.

Report bugs at
[GitHub Issues](https://github.com/omnigami-ai/mcp/issues). For questions or a
private report, email [hello@omnigami.ai](mailto:hello@omnigami.ai). Include your
Node/client versions, the tool and a minimal example; omit private product data.

omnigami is a product of Auberon LLC and is not affiliated with Anthropic.
