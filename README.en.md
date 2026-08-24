# deel-local-cli

A coding agent CLI that runs entirely on **local models or your own private gateway**.
**Zero dependencies** — nothing but Node's own standard library.

> The interface and source comments are in Korean. This file is the English guide.

---

## Why zero dependencies

This was built for an offline corporate network where installing third-party
software requires review. `dependencies` is empty and stays empty — that fact is
the argument you hand to a security team.

```
npm ls           →  no dependencies
cat package.json →  "dependencies": {}
```

All you need is **Node 20+**. There is no `npm install` step.

---

## Install

```bash
npm install -g deel-local-cli
# or run without installing
npx deel-local-cli setup
```

For an air-gapped machine, copy the folder across and run `node bin/deel.js`
directly. Nothing is installed on the target machine.

---

## Connect

```bash
deel setup
```

It asks for a name, base URL and API key, probes the endpoint, lists the models
it found, and saves the profile to `~/.deel/config.json`.

Point it at anything OpenAI-compatible:

| | Example URL |
|---|---|
| Private AI gateway | `https://ai-gw.example.corp/v1` |
| Ollama | `http://localhost:11434` |
| LM Studio | `http://localhost:1234/v1` |
| vLLM / LiteLLM | `http://host:port/v1` |

The auth style is detected automatically — `Authorization: Bearer`, `x-api-key`,
`api-key` (Azure-style), or none.

### Keeping the key out of the config file

```bash
export DEEL_API_KEY=sk-xxxx      # takes precedence over the file
deel diagnose --url https://ai-gw.example.corp/v1 --model sec-llm-01
```

Other environment variables: `NODE_EXTRA_CA_CERTS` (corporate CA),
`HTTPS_PROXY`, `DEEL_DEBUG=1` (full stack traces).

---

## Diagnose a gateway

Before trusting an endpoint, find out what it actually supports:

```bash
deel diagnose --url <base-url> --key <key> --model <model> --out report.txt
```

| Check | Why it matters |
|---|---|
| Basic chat | URL, key and model name are right |
| System message | Whether rules and skills take effect |
| Streaming | Whether output can arrive token by token |
| **Tool calling** | **Whether files can be read and edited — the critical one** |
| **Tool result round-trip** | **Whether multi-turn works — the agent loop depends on it** |
| Structured output | Whether edit formats can be schema-enforced |
| Reasoning effort | Whether `/think` reaches the model |
| Context length | How many files fit at once |

It ends with a verdict: **ready / limited / blocked / unreachable**, plus a
plain-text report you can hand to whoever runs the gateway.

Reasoning models are handled correctly: if all output lands in `thinking` and
the body gets truncated, it retries with thinking disabled instead of reporting
a false failure.

---

## Chat

Run it inside the folder you want to work in. That folder becomes the **scope** —
nothing outside it can be read or written, even if the model asks.

```
  deel  sec-llm-01  ·  /home/you/project
  skills: 337 · commands: 127 (42 plugins)

› unify the log format

  ⏺ Grep(console.log)
    └ 1 file · 1 match

  ⏺ Read(src/runner.js)
    └ 5 lines

  ⏺ Edit(src/runner.js)
    └ 1 occurrence

  Unified the log calls to the logger format. One change in runner.js.

  ─ 4.2s · 3 tools · 180 tokens
```

### Slash commands

Names follow the Claude Code / Codex convention.

| Command | |
|---|---|
| `/help` | list commands |
| `/context` | context usage — what is taking up room |
| `/compact` · `/clear` | shrink · wipe the conversation |
| `/model` | switch connection or model (conversation continues) |
| `/think off\|low\|medium\|high\|max` | reasoning effort |
| `/mode auto\|confirm\|strict` | execution mode |
| `/undo [n]` | roll back the last n turns |
| `/tools` · `/skills` | what is available |
| `/cost` · `/status` | usage · connection |
| `/init` | create a `DEEL.md` rules file |

### Tools

Names and arguments match Claude Code, so skills and commands written for that
convention work unchanged.

`Read` · `Write` · `Edit` · `Glob` · `Grep` · `Bash` · `Skill`

---

## Edits survive sloppy models

Models routinely get whitespace, indentation and line endings slightly wrong.
`Edit` relaxes matching in stages — but **refuses outright when ambiguous**,
because silently editing the wrong place is far worse than not finding it.

```
exact  →  trailing space & CRLF  →  indentation  →  all whitespace
```

Measured by `npm run bench`:

```
should-fix cases   exact-only 2/10 (20%)  →  staged 10/10 (100%)
should-refuse      5/5 (100%)  ·  wrong-place edits: 0
```

When it fails, it points at the closest real line so the model can correct itself:

```
Not found.
  Line 2 of the file is closest:
    console.log("start: " + id);
  Copy that line verbatim and try again.
```

---

## Skills and commands come from the host machine

Nothing is bundled. On startup it scans:

```
project  ./.deel/skills   ./.claude/skills   ./.deel/commands   ./.claude/commands
user     ~/.deel/skills   ~/.claude/skills   ~/.claude/commands
plugins  ~/.claude/plugins/**   (any folder with .claude-plugin/plugin.json)
```

It reads the Claude Code format: `SKILL.md` with YAML frontmatter,
`commands/*.md` with `$ARGUMENTS` substitution.

### Loaded in three stages

Listing everything would blow the context window. So:

| Stage | What | Cost |
|---|---|---|
| 1 | name + one-line description in the system prompt | ~1,800 tokens for 40 |
| 2 | the model calls `Skill` for the one body it wants | one at a time |
| 3 | files that body references, via `Read` | only if needed |

On a machine with 337 skills, listing 40 costs about 1,800 tokens instead of
well over 100,000.

Not supported on purpose: **hooks** (executable scripts — a review problem and an
extra failure path for autonomous execution), **subagents** (doubles model calls
against a gateway quota), and **MCP** (a separate protocol, a project of its own).

---

## Safety without approval prompts

The default mode is `auto`: it edits files and runs commands without asking.
The safety net is that everything is **reversible**, not that everything is gated.

| | |
|---|---|
| **Undo** | every file is snapshotted before it changes; `/undo` restores by turn |
| **Scope** | the starting folder is a hard boundary |
| **Blocked commands** | only irreversible ones — disk format, recursive delete, force-push, piping downloads into a shell. Ordinary commands pass |
| **No re-run** | a mutating command is never retried after failure — running it twice is the accident |
| **Audit log** | everything lands in `.deel/audit.jsonl` |

`/mode confirm` asks before irreversible commands; `/mode strict` asks before
every file change and command.

---

## Development

```bash
npm run check   # syntax across every module
npm test        # 20 tool checks + 16 engine checks + the edit benchmark
npm run demo    # see the chat screen, driven by a fake gateway
npm run bench   # edit reliability numbers
```

The engine tests spin up a **fake OpenAI-compatible gateway** over HTTP. No real
model is involved, so the loop, streaming parser, tool execution and undo are all
verified deterministically — including the case where a gateway splits tool-call
arguments across streaming chunks.

---

## License

MIT
