[← back to README](../../README.md)

# Development

Running the tests, coverage, the folder layout

---

## Development

<sub>Coverage · Layout</sub>

### Coverage

```bash
npm run coverage                           Summary
node test/coverage.mjs --file src/repl.js  One file in detail
node test/coverage.mjs --json              Machine-readable
```

Zero dependencies rules out c8 and nyc, so this reads Node's own
`NODE_V8_COVERAGE` instead — nothing new to get through an import review. It picks up
child processes too, so the `cli` suite that spawns `deel` counts like everything else.

Currently **92% overall** (7,056 of 7,646 lines). Three files are deliberately left short.

| File | Now | Why it stops there |
|---|---|---|
| `tools/excel.js` | 67% | The password path needs Excel installed and a genuinely encrypted file. Faking it would produce a test that only *looks* like it passes |
| `repl.js` | 77% | The keypress paths — Shift+Tab, Ctrl+C, password entry, paste. Reaching them needs a pty, and a pty is a dependency. What the screen *prints* is measured instead, as a value (`ui` and `tui` suites) |
| `plugins/manage.js` | 79% | The GitHub download path. **Tests not reaching the network** matters more. Folder installs are covered |

### Layout

```
bin/deel.js              entry point
src/
  repl.js                the conversation screen — what a person faces
  oneshot.js             run once and exit (-p)
  commands.js            35 slash commands
  setup.js               first-run connection setup
  config.js              reading and writing config

  ui/ansi.js             colour · East Asian width
  ui/screen.js           picking a screen (line mode / box mode)
  ui/inputbox.js         the box at the bottom — overwrite-in-place, cursor position
  ui/status.js           status line — model, context, mode, approvals
  ui/working.js          working phrases — they follow what is happening
  ui/motion.js           the braille drawing next to the phrase
  ui/intro.js            the startup motion
  ui/banner.js           the large name — a line closes and names the boundary
  ui/approve.js          approval mode display (auto / risky only / everything)
  ui/diff.js             showing what changed, where it changed
  ui/export.js           conversation → a one-page report (/export)
  ui/wrap.js             wrapping to width without breaking colour
  ui/level.js            simple vs developer

  agent/loop.js          the agent loop
  agent/session.js       conversation state + context accounting
  agent/modes.js         work modes (auto · code · plan · architect · debug · ask · orchestrator)
  agent/route.js         picking the mode from what was said
  agent/effort.js        per-stage reasoning effort
  agent/budget.js        shares that follow the window — lines read, description length, steps
  agent/project.js       working out what kind of project this folder is
  agent/compact.js       summarising compaction
  agent/store.js         saving and resuming conversations
  agent/recall.js        searching past conversations (no index, within budget)
  agent/memory.js        what outlives the conversation
  agent/mention.js       attaching files with `@`
  agent/card.js          experienced habits → harness adjustments (/model card)
  agent/preset.js        models known before they are experienced — Korean-model name tags

  backend/http.js        the single HTTP layer (the only door out)
  backend/detect.js      protocol and auth detection
  backend/adapter.js     absorbing OpenAI/Ollama differences + streaming parser
  backend/retry.js       when to wait and call again (429 · 5xx · dropped connections)
  backend/proxy.js       reading HTTPS_PROXY · NO_PROXY — choosing the way out
  backend/learn.js       learning limits from what the server said (context · reply length)
  backend/ctxsize.js     reading context length off the model
  backend/probe.js       8 diagnostic checks
  backend/scan.js        scanning for local servers
  backend/mcp.js         attaching outside tools (MCP, stdio)

  tools/index.js         17 tools
  tools/edit-match.js    staged-relaxation edit matching
  tools/outline.js       a file's shape, cheaply
  tools/verify.js        checking what was built
  tools/task.js          splitting big work off
  tools/jobs.js          commands that run in the background
  tools/todo.js          checklists
  tools/webfetch.js      reading the web (read-only)
  tools/encoding.js      writing back in the encoding it was read in
  tools/xlsx.js          Excel → CSV (written here)
  tools/docs.js          hwpx·docx·pptx → text (written here)
  tools/lsp.js           Def · Refs — asking the language server

  lsp/rpc.js             LSP framing (Content-Length + JSON-RPC, written here)
  lsp/servers.js         finding installed language servers (installs nothing)
  lsp/client.js          one server: spawn, talk, time out, clean up
  lsp/diag.js            is the file you just edited sound?

  preview/serve.js       serving what you built (127.0.0.1 only)
  skills/discover.js     finding skills, commands and plugins on the machine
  plugins/manage.js      installing, removing and packing plugins
  pack/zip.js            ZIP writing (written here, keeps non-ASCII names)
  pack/tar.js            TAR reading (written here)
  pack/selfpack.js       review dossier + source bundle

  safety/network.js      the lock on the way out
  safety/guard.js        working scope + dangerous-command blocking
  safety/undo.js         snapshots and undo
  safety/audit.js        recording what happened, and when
test/                    tests (excluded from the published package)
```

## Releasing

Releases are **not published by hand.** Push a tag and GitHub Actions runs the full
test suite, publishes, and attaches a signed statement that this version was built
from this repository at this commit (npm provenance). Anyone can verify the commit
hash on the npm page — which is exactly what a corporate review asks for when it
wants to know whether the tarball matches the published source.

```bash
# after bumping the version in package.json and committing
git tag v1.4.0
git push origin v1.4.0
```

If the tag and `package.json` disagree, it stops before publishing. npm never lets
the same version be published twice, so a mismatch that gets out cannot be undone.

### There is no key to store

This repository publishes through **trusted publishing** (OIDC). The package
settings on npmjs.com name this repository and the **workflow filename**
(`publish.yml`), and the workflow publishes with a short-lived credential it
receives at that moment.

**Do not add an `NPM_TOKEN` secret.** If a token is present, `setup-node` writes it
into `.npmrc` and npm stops using OIDC. This package forbids token publishing
(`mfa=publish`), so that path ends in **403**. An earlier version of this document
told you to create an Automation token; that route is closed.

**Renaming `publish.yml` means changing the registration on npmjs.com too.**
Otherwise it becomes an unregistered workflow and is rejected on the spot.

### Line endings are LF only

Every file that ships must use **LF**. `.gitattributes` pins `eol=lf`, and
`npm run check` verifies it on every release.

One thing to know if you work on Windows: **git does not retroactively fix files
that were already checked out** when `.gitattributes` appeared. Files pulled down
before that rule existed, under `core.autocrlf=true`, stay on disk as CRLF — and
`npm pack` packs the **working tree**, not git. So `git status` can be clean while
the published artifact is wrong.

That is exactly how 1.13.0 shipped: 47 of 148 files had CRLF, and the tarball's
shasum did not match the one CI built. Had the shebang been affected, the program
would not have started at all on Linux or macOS
(`env: 'node\r': No such file or directory`).

When `npm run check` reports CRLF, this is how to undo it:

```bash
# which files disagree
git ls-files --eol | grep 'w/crlf'

# delete and re-check-out (only with a clean working tree)
git ls-files --eol | grep 'w/crlf' | sed 's/.*\t//' | while read -r f; do rm -f "$f"; done
git checkout -- .
```

`git add --renormalize .` will not fix it: the index is already correct: only the
working tree drifted.

To confirm, compare shasums — for a given commit, `npm pack` must produce the same
shasum on every OS.

---

[← back to README](../../README.md)
