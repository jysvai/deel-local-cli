<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/jysvai/deel-local-cli/main/docs/assets/hero-en-dark.svg">
  <img alt="deel — stays on this machine" src="https://raw.githubusercontent.com/jysvai/deel-local-cli/main/docs/assets/hero-en-light.svg" width="620">
</picture>

### A coding-agent CLI that runs on local models and private gateways

Zero dependencies · Node 20+ · Exactly one place your source can go

Vendor APIs connect too — **only when you say so**

<br>

[![npm](https://img.shields.io/npm/v/deel-local-cli?logo=npm&logoColor=white&label=npm&color=cb3837)](https://www.npmjs.com/package/deel-local-cli)
[![downloads](https://img.shields.io/npm/dt/deel-local-cli?label=downloads&color=1a7f37)](https://www.npmjs.com/package/deel-local-cli)
[![node](https://img.shields.io/node/v/deel-local-cli?logo=nodedotjs&logoColor=white&label=node&color=5FA04E)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/deel-local-cli?label=license&color=0969da)](LICENSE)

[![Node.js CI](https://img.shields.io/github/actions/workflow/status/jysvai/deel-local-cli/test.yml?branch=main&logo=github&logoColor=white&label=Node.js%20CI)](https://github.com/jysvai/deel-local-cli/actions/workflows/test.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/jysvai/deel-local-cli/codeql.yml?branch=main&logo=github&logoColor=white&label=CodeQL)](https://github.com/jysvai/deel-local-cli/actions/workflows/codeql.yml)
[![tests](https://img.shields.io/badge/tests-5%2C899%20passing-1a7f37?logo=checkmarx&logoColor=white)](docs/en/develop.md)

[![dependencies](https://img.shields.io/badge/dependencies-0-1a7f37)](https://www.npmjs.com/package/deel-local-cli?activeTab=dependencies)
[![ESM](https://img.shields.io/badge/ESM-Node%2020%2B-5FA04E?logo=javascript&logoColor=white)](package.json)
[![network](https://img.shields.io/badge/network-127.0.0.1%20only-1a7f37?logo=wireguard&logoColor=white)](#where-your-data-can-go)
[![telemetry](https://img.shields.io/badge/telemetry-none-1a7f37?logo=ghostery&logoColor=white)](#where-your-data-can-go)

**[한국어](README.ko.md)** · [Corporate review](#corporate-review-package) · [Troubleshooting](#troubleshooting) · [Full docs](docs/en/)

</div>

---

### The first thing you see answers the only question that matters

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/jysvai/deel-local-cli/main/docs/assets/shot-head-en-dark.svg">
  <img alt="deel startup panel: model, where it sends, link capabilities, folder, approval mode" src="https://raw.githubusercontent.com/jysvai/deel-local-cli/main/docs/assets/shot-head-en-light.svg" width="900">
</picture>

**`sends to  this machine 127.0.0.1 ← and nowhere else`.** Not in a policy document —
on screen, every time you start. The `⌂` in front stays in the status bar for the whole
session and turns into `↗` the moment traffic would leave. A real capture, not a mockup:
`node tools/shot.mjs` regenerates every image on this page from a live run.

<br>

Then you give it work, and it goes and does it:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/jysvai/deel-local-cli/main/docs/assets/shot-chat-en-dark.svg">
  <img alt="deel doing a task end to end: Grep, Read, Edit with an inline diff, and the file it wrote" src="https://raw.githubusercontent.com/jysvai/deel-local-cli/main/docs/assets/shot-chat-en-light.svg" width="900">
</picture>

Every number in that image is real — the tools ran against real files. Only the model is a
stub on `127.0.0.1`, so the capture is reproducible; the tool calls, the diff and the file
summary are what deel actually printed.

---

## 60 seconds

```bash
npm i -g deel-local-cli    # 0 dependencies, no install scripts
deel setup                 # point it at Ollama, LM Studio, or your gateway
deel                       # start working in the current folder
```

No account, no sign-up, no telemetry. If you already run Ollama or LM Studio,
`deel setup` finds it — `deel scan` lists every local runtime and model on the machine.

---

<details>
<summary><b>Contents</b> — every section on this page</summary>

<br>

- [Why this exists](#why-this-exists)
- [What's different](#whats-different)
- [Quick start](#quick-start)
- [Where your data can go](#where-your-data-can-go)
- [Connecting a vendor API](#connecting-a-vendor-api)
- [Keys that expire (corporate gateways)](#keys-that-expire-corporate-gateways)
- [Multiple local runtimes](#multiple-local-runtimes)
- [Slash commands](#slash-commands)
- [Work modes](#work-modes)
- [Simple vs developer](#simple-vs-developer)
- [Tools](#tools)
- [Korean text and Excel](#korean-text-and-excel)
- [Serving what you built](#serving-what-you-built)
- [Skills and plugins](#skills-and-plugins)
- [Reasoning effort](#reasoning-effort)
- [Auto-compaction](#auto-compaction)
- [Resuming a conversation](#resuming-a-conversation)
- [Attaching tools from outside (MCP)](#attaching-tools-from-outside-mcp)
- [Inside your editor (ACP)](#inside-your-editor-acp)
- [Keeping secrets out of the conversation](#keeping-secrets-out-of-the-conversation)
- [Safety](#safety)
- [Corporate review package](#corporate-review-package)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Release notes](#release-notes)

</details>

This page is the **summary**. Each section links to the detail behind it.

| Full docs | What is in there |
|---|---|
| [Models](docs/en/models.md) | Grade and window size · Korean-model presets · project detection |
| [The screen](docs/en/interface.md) | The input box · work modes · simple vs developer · what it asks about |
| [Tools in depth](docs/en/tools.md) | `Outline` · `Verify` · `Task` · `Jobs` · `Append` · `Def`/`Refs` · edit matching |
| [Korean documents and Excel](docs/en/documents.md) | hwpx/docx/pptx/**PDF** · encoding · Excel → CSV |
| [Extending](docs/en/extend.md) | Skills · plugins · MCP · ACP |
| [Speed and spend](docs/en/tuning.md) | Per-stage effort · the prefix cache · context length |
| [Safety and corporate review](docs/en/safety.md) | Undo · working scope · audit log · the review package |
| [Configuration](docs/en/config.md) · [Development](docs/en/develop.md) | Env vars · run flags · running the tests · folder layout |
| [Release notes](docs/en/releases.md) | [1.10.x](docs/en/releases/1.10.md) · [1.9.x](docs/en/releases/1.9.md) · [1.8.x](docs/en/releases/1.8.md) · [1.7.x](docs/en/releases/1.7.md) · [older](docs/en/releases.md) |

---

## Why this exists

When a corporate security policy blocks **unapproved software**, most coding-agent tools are
unusable: hundreds of transitive dependencies, scripts that run at install time, and no
one-line answer to "where does it send my code?"

deel is built to pass that review.

| | deel |
|---|---|
| External dependencies | **0** — Node built-ins only |
| Install scripts | **none** — unzip and run |
| Where source can go | **one address** — the one you configured |
| Requirement | Node 20+ |

Verify it yourself:

```bash
npm view deel-local-cli dependencies   # {}
npm view deel-local-cli scripts        # no install/postinstall
deel audit                             # full review sheet
```

---

## What's different

A handful of coding agents can talk to a local model. Far fewer were
**redesigned inside for running locally.**

| | Other tools | deel |
|---|---|---|
| `/undo` | rolls back files only — the conversation still believes it happened | rewinds **the conversation too** |
| Long conversations | pay a cost cloud tools never feel, unchanged, locally | ordering designed so the prefix cache **survives** |
| Edits on small models | fail on a single whitespace mismatch | 20%→**100%** success, 0 wrong-location edits |
| Korean models | unknown until you've run them | known **in advance** from public docs |
| "Done" | says so even for what wasn't checked | `/evidence` / `/export` — **unproven items included** |
| MCP · ACP | need an SDK | `child_process` + `JSON`, nothing else |
| Compliance paperwork | hand-written, drifts from reality | **generated by scanning the source** |

<br>

#### `/undo` rewinds the conversation along with the files

Roll back only the files and the model still believes it just made that edit
— it builds the next step on a premise that no longer holds, and nothing on
screen says otherwise. deel folds the messages back in lockstep with the
files. Folding can orphan a tool call, which the server answers with a 400,
so the same pass repairs the pairing (`repairToolPairs`).

#### Fixed the hidden reason local models get slower as a conversation grows

Ollama and llama.cpp only reuse computation when a request's prefix exactly
matches the last one — change one character near the front and everything
after it, the whole conversation, gets recomputed. A cloud API never pays
this cost, so cloud-first tools have no reason to care; someone running
locally feels it compound every turn. deel pushes what can change per turn
(mode, pins) to the **end** of the prompt and sends Ollama `keep_alive: 60m`
so the front stays cached. The ordering is enforced by a test
(`test/cache.test.js`).

#### Edits actually succeed on small models

Small local models often can't reproduce the exact whitespace of the string
they're trying to edit. The internal benchmark (`npm run bench`) measured
20% success for the old exact-match-only approach. The current approach
(stepped whitespace/indent tolerance) measures **100%** — and both approaches
land at **0** wrong-location edits. When it's ambiguous, it says so instead
of guessing.

#### Korean models are known before you've ever run them

EXAONE, HyperCLOVA X, Kanana, Midm, and Solar get whatever's verifiable from
public documentation (e.g., whether a model is a reasoning model) applied
before the first prompt. Other tools meet these models cold, and it takes a
dozen-plus turns of trial and error before anyone learns their quirks.

#### "Done" comes with a receipt, not just a claim

`/evidence` and `/export` record what wasn't verified alongside what was —
because the moment an AI coding tool is most likely to mislead someone is
exactly the moment it confidently says "done." `/export` is a self-contained
HTML file with zero outbound links, so it opens anywhere, including an
air-gapped network.

#### MCP and ACP, with no SDK

Both the Model Context Protocol and the Agent Client Protocol are just
newline-delimited JSON-RPC 2.0 over stdio. deel implements both with nothing
but `child_process` and `JSON` — proof that zero dependencies isn't a
capability given up, it's a capability that was never needed.

#### Compliance paperwork it doesn't hand-write

The import-review report, SBOM, and audit spec that `deel pack` produces are
generated **by scanning the actual source**, not typed by a person.
Hand-written paperwork eventually drifts from reality, and the moment a
reviewer catches one drifted claim, they stop trusting the rest of it.

---

## Quick start

### The screen speaks your language

deel is written in Korean — the code, the function names, the comments. That part stays.
What you see on screen does not have to. Four screen languages ship: **한국어 · English ·
日本語 · 中文**.

> **How this is kept honest:** `/lang` counting the table is not enough — it can only count
> strings that made it *into* the table, and for a long time the tool result summaries and the
> thinking indicator never did. So a test starts deel in each language and reads the screen:
> `test/langleak.test.js` walks seven screens and fails if a Korean character shows up on an
> English one. It also fails on `1 files`, and on a stray `·` left dangling at the end of a line.

```bash
DEEL_LANG=en deel        # this run only  (also ja, zh)
/lang en                 # and remember it
/lang ja                 # 日本語
/lang zh                 # 中文
/lang                    # how much is translated so far
```

Nothing ever comes through blank. A line that has not been translated falls back to English
first and Korean second — so a Japanese or Chinese screen degrades to English, not to Korean —
and `/lang` prints exactly how many strings are covered.

What the model reads follows the same switch. Set it to English and the rules, the mode
instructions, and the tool descriptions all go out in English — so the model answers you in
English instead of Korean. That side is cheaper, too: the part of the window that ships on every
single request drops from about 4,900 tokens to about 3,450 — on a 32k model, from 15% of the
window to 10.5%.

Tool and argument names are ASCII in every language — `Read(file_path)`, `Task(purpose)`.
Those are identifiers, not prose, and several vendors reject a non-ASCII name outright.
The Korean names some models learned earlier are still accepted on the way *in*, so a model
that sends `목적` instead of `purpose` still gets through.

### Install

```bash
npm install -g deel-local-cli
```

Or skip installing entirely — there is no `npm install` step:

```bash
git clone https://github.com/jysvai/deel-local-cli
node deel-local-cli/bin/deel.js
```

> **Note** — do not run `npm install` in your home directory. A `node_modules` there makes every
> later npm command scan it and report warnings about unrelated packages. Use `-g` or `npx`.

### Point it at a model

Scan this machine and pick one:

```bash
deel scan --pick
```

Or enter an address directly (use this for a corporate gateway):

```bash
deel setup
```

### Start

Run `deel` in the folder you want to work in. **That folder becomes the scope — files outside it
cannot be read or written.**

```bash
cd C:\work\myproject
deel
```

---

## Where your data can go

A coding agent ships your whole source to a model. **The address is everything.**
Rather than promising in prose, the code enforces it: `src/safety/network.js` checks every request
and never builds one for an address that is not on the allow-list.

```
 [A] Model gateway ────── the only path your source travels
     One address, set in `setup`. Switching models closes the previous one.

 [B] Web read (WebFetch) ─ receive-only
     GET only, zero-byte body. Private/loopback addresses refused. Every visit logged.

 [C] Plugin fetch ─────── open only while /plugin install runs

 [D] MCP servers ──────── a separate child process, someone else's program
     Only starts if a human writes it into .deel/mcp.json. Off by default.
```

A, B, and C are requests deel makes itself, so each one can be filtered.
**D is different** — an MCP server is its own process; there is no way to see
what sockets it opens from the outside. So under `--offline`, instead of
filtering its requests, deel **never starts the server at all** — it doesn't
claim to have blocked what it can't actually see.

Pass `--offline` and **B, C, and D are all closed** — traffic stays on this machine.

```bash
deel --offline
```

The destination is printed at the top of every session:

```
 deel 1.10.0  ⌂ inside
 Sends to this machine 127.0.0.1:11434  ← nowhere else
```

### Three run modes

Through 1.6 the only lock was `--offline`, and **the default was open**. One
line in `.deel/config.json` pointing outside was enough. The screen did show
`↗`, but that is a *notice*, not a lock.

| Mode | How | On an external address |
|---|---|---|
| `⌂ inside` | `deel` (default) | **Asks.** Say yes once and that connection stops asking |
| `↗ outside` | `deel online` · `--online` | Does not ask |
| `⛊ sealed` | `deel offline` · `--offline` | Ignores even remembered permission (strongest) |

**Both the address and the permission are required.** Changing the address
alone does not get you out.

Local and intranet ranges (`127.x` · `10.x` · `192.168.x` · `172.16-31.x`) pass
in all three modes — `offline` does not mean "no internet," it means "nothing
leaves the company." 

Nothing is collected or transmitted. No telemetry, no usage stats, no crash reporting.
Conversation history, undo snapshots and config live only in `.deel/` inside your working folder.

> Verified by 159 checks in `npm test` (network + web + mcp), including bringing up a real
> server and confirming that **not a single request reaches it** when it is not allow-listed,
> and that an MCP server **never starts** under `--offline`.

---

## Connecting a vendor API

Local models are the default and that does not change. But "we have no GPU
in-house" and "just this one task on a bigger model" are real situations, so
vendor APIs can connect. **The modes above guard that door.**

```bash
deel setup
```

Instead of asking for a URL, it asks **where you're connecting**.

```
1. I only have a key — I'll figure out where it goes    1 blank
2. Enter an address (corporate gateway · local)          2 blanks
3. OpenAI (GPT)                                          1 blank
4. Anthropic (Claude)                                    1 blank
5. Google (Gemini)                                       1 blank
6. AWS Bedrock                                           2 blanks
```

Option 1 is the point — the key prefix decides which single vendor is asked.

```
❯ sk-ant-api03-••••
  ✓ Looks like an Anthropic (Claude) key. (the key starts with sk-ant-)
    It is not thrown at every vendor in turn.
```

Probing vendors one by one would send an Anthropic key to OpenAI's server and
then to Google's. You get a 401 and stop — but **the key has already left.**
So an unrecognized key is never guessed at; you are asked.

Bedrock asks for a region — five including Seoul (`ap-northeast-2`), plus
"enter it yourself." Claude has a different wire shape, absorbed in six places
([1.7.0 release notes](docs/en/releases/1.7.md#170)).

### Going outside masks secrets in file contents too

While everything stayed local, text read from files was deliberately **not**
masked: mask it and the model writes the mask back into the file, destroying
your real key.

Going outside flips that trade. One `Read` puts your whole `.env` into someone
else's server log, and that cannot be undone. The other side is now handled
elsewhere — `Write`, `Append` and `Edit` refuse to write a mask back into a file.

### You can see what it costs

```
❯ ─ 12.4s · 3 tools · ↑8.2k ↓1.1k · $0.0271
```

**There is no built-in price table.** Prices change whenever a vendor decides,
and a table baked into source would have the tool confidently printing wrong
amounts six months later. Write them in `.deel/config.json` — dollars per
million tokens:

```json
"pricing": { "claude-opus-4-6": { "input": 0, "output": 0, "asOf": "2026-09-01" } }
```

The amount is shown with **where it came from and as of when**, and after six
months it is marked stale. Unknown means nothing is printed — a local-only
session never sees money at all.

---

## Keys that expire (corporate gateways)

Corporate gateways do not hand out a fixed key. They hand out a one-hour token, behind a
corporate login. Pasting one in works until lunch, and then you get `HTTP 401` — a message
that **does not distinguish "wrong key" from "old key."** People go re-issue a key that was
never the problem.

So write down *how to get a key* instead of the key:

```json
"authCommand": {
  "command": "az account get-access-token --resource api://ai-gw --query accessToken -o tsv",
  "ttl": 3600
}
```

It runs right before a request, keeps the result in memory only, and fetches a fresh one a
minute before expiry — a token alive when the request left and dead when it arrived is
exactly that 401. On a 401 it fetches once more and retries **once**; a second 401 means you
genuinely lack access.

| | |
|---|---|
| You write the path | Nothing is auto-detected. Guessing at `az` on your PATH would mean you no longer know when this program runs what |
| Separate process | Never `import`ed — code inside our process would see other keys and the conversation |
| Asked once per session | Not once per fetch. Three prompts and people just press the key |
| Not while sealed | An `--offline` session does not go out to a login portal |
| Never written to disk | Memory only, for the life of the session |
| Banner output rejected | `Logged in as …` followed by a token gets a 400 from the gateway, indistinguishable on screen from a wrong key. The first line is shown back so you know to add `--query` |

`/status` says `Key store  fetched · 52 min left` — not "stored", because we are not holding
it. An organisation can set the same block in the [managed policy](docs/en/config.md) file,
where it overrides the user's config and is never asked about.

---

## Multiple local runtimes

People rarely run just one. `deel scan` knocks on 13 known ports concurrently and identifies
each runtime from its **response**, not its port number — Ollama by `/api/version`,
LM Studio by `/api/v0/models`, llama.cpp by `/props`. Unrecognised ones are marked as a guess.

```
$ deel scan

  ✓ found 3

  ◆ Ollama      127.0.0.1:11434   Ollama API      36ms
      · qwen2.5-coder:7b            7B · 4.4GB
      · llama3.2:1b                 1B · 1.2GB
  ◆ LM Studio   127.0.0.1:1234     OpenAI-compat    7ms
      · devstral-small-2507
  ◆ llama.cpp   127.0.0.1:8080     OpenAI-compat    7ms
      · gemma-3-4b-it

  Recommended  Ollama · qwen2.5-coder:7b
```

| Command | What it does |
|---|---|
| `deel scan` | Show what is running |
| `deel scan --pick` | Choose one from the list |
| `deel scan --save` | Register everything found |
| `deel scan --ports 9000,9100` | Extra ports to probe |
| `deel scan --host <addr>` | Defaults to `127.0.0.1` |

Switch with `/model` mid-conversation — **the conversation carries over.**

> **More** — It adapts to whatever model is attached · Korean models are known before they are experienced · Small windows get a smaller fixed share · On startup it reads what kind of project this folder is
>
> **[Models read →](docs/en/models.md#multiple-local-runtimes)**

---

## Slash commands

Names follow Claude Code / Codex conventions.

| Command | What it does |
|---|---|
| `/help` | Command list |
| `/lang [ko\|en] [prompt lang]` | Screen language. **The prompt language is a separate axis** — `/lang en ko` instructs the model in Korean while answering you in English. Korean screen + English prompt cuts the 8k fixed share by 23% |
| `/keys` | Press keys to see what your terminal actually sends — for when new lines will not work |
| `/bell [on\|off]` | Ring and set the window title when a turn ends, or when deel needs an answer |
| `/consult <profile> <question>` | Ask a second model one question. Your current model stays put |
| `/export` | This conversation as a **one-page HTML report** — asked, changed, verified. Self-contained, opens on any network |
| `/lsp [on\|off]` | Language servers — what is installed, and whether `Def`/`Refs` are available. `off` turns post-edit diagnostics off only |
| `/context` | What is consuming the context window |
| `/ctx [auto\|number]` | Context **length** — re-read it off the model, or set it yourself |
| `/grade [small\|medium\|large\|auto]` | Model **grade** — how much it does on its own. A different axis from `/ctx` |
| `/out [number\|auto]` | Cap on a **single reply** — raise it when large files get cut |
| `/compact` | Summarise and fold older turns |
| `/clear` | Clear the conversation (keeps link and rules) |
| `/thread [new\|fork\|close\|n]` | Conversation threads — side work in its own context. Link and undo stay shared |
| `/learned [clear]` | What deel has picked up on its own — commands that work here, this model's habits |
| `/pin <text>` | Pin a line — folding and compaction **cannot reach it** |
| `/evidence [file]` | Evidence — what changed, and what proves it. **What is unproven is listed too** |
| `/commit [all\|preview\|title]` | Commits only what this session changed; message from the diff and the evidence. **Never pushes** |
| `/model` | Switch connection / model |
| `/model card` | Model card — what this model has actually done here, and what deel changed because of it |
| `/think <level>` | Reasoning level (`off·low·medium·high·max`) |
| `/think profile <name>` | Per-stage profile (`even·save·deep`) |
| `/think detail` | Stage table — which stage runs at which level and cap |
| `/mode <mode>` | Approval policy — how much it asks (`auto` · `confirm` · `strict`) |
| `/work [mode]` | Work mode — what kind of work you are doing |
| `/auto` | Hand the wheel back — it picks the mode from what you type |
| `/code` `/plan` `/architect` `/debug` `/ask` `/orchestrator` | Switch work mode directly (pins it) |
| `/level [level]` | How much to show (`simple` · `developer`) |
| `/motion [plain\|knight\|animal\|office\|off]` | What animates while it works — takes effect at once, and is saved |
| `/undo [turns]` | Revert file changes |
| `/diff [file]` | Files changed this session, and the changed lines |
| `/preview [folder\|file\|off]` | Serve what you built, right here — a browser opens with it |
| `/tools` | Available tools |
| `/skills [query\|all\|off]` | Browse, search, load skills |
| `/plugin [install\|remove\|pack]` | Manage plugins |
| `/cost` | Session usage |
| `/status` | Connection status |
| `/scan [save]` | Sweep this machine for local model servers (`save` registers them) |
| `/sessions` | Past conversations in this folder |
| `/recall <text>` | Search past conversations **by content** |
| `/memory` | What persists across sessions — view, add, delete |
| `/mcp` | Externally attached tools (MCP servers) |
| `/init` | Create a `DEEL.md` rules file |
| `/exit` | Quit |

Discovered plugin commands are invoked as `/<plugin>:<name>`, with `$ARGUMENTS` substituted.

`/scan` and `/sessions` work without leaving the session. If you just started another local
server or loaded a different model, `/scan save` then `/model` switches over without losing
the conversation.

**Without typing**

| Key | What it does |
|---|---|
| `Tab` | Completes the `/` command you are typing. Candidates appear under the box as you type |
| `Shift+Tab` | Approval policy (`⏵⏵ auto` → `⏵ risky only` → `⏸ everything`) |
| `Ctrl+O` | Work mode (`Auto` → `Code` → `Plan` → …) |
| `↑` `↓` | Input history |
| `Ctrl+C` | Stops the answer in progress; twice on an empty line quits |
| Typing while it works, then `Enter` | Steers without throwing anything away — takes effect from the next step |

Korean IME composition, paste, `Ctrl+A/E` and backspace all keep working.

> **More** — Attaching a file with @ · Interrupting · Steering without stopping
>
> **[The screen read →](docs/en/interface.md#slash-commands)**

---

## Work modes

What you are working on changes **which tools the model is given and how hard it thinks.**
Cycle with `Shift+Tab`, or type the name.

| Mode | For | Can edit files | Reasoning |
|---|---|---|---|
| `/auto` ◎ Auto | **Default.** Reads your message and switches for you | Yes | Normal (`save`) |
| `/code` ◆ Code | Writing and fixing | Yes | Normal (`save`) |
| `/plan` ☰ Plan | Planning first | **No** | Deep (`deep`·high) |
| `/architect` ◈ Architect | Shaping structure | **No** | Deep (`deep`·high) |
| `/debug` ◉ Debug | Finding causes | Yes | Deep, more steps (32) |
| `/ask` ◇ Ask | Explaining only | **No** | Shallow (`low`) |
| `/orchestrator` ❋ Orchestrator | Breaking up large work | Yes | Many steps (40) |

In read-only modes, `Write`, `Edit` and `Bash` are **never sent to the model at all.**
It is not asked politely not to edit — models forget requests. A tool that isn't there can't be used.

Don't confuse this with `/mode`. They are separate axes:

- `/mode` — **how much it asks you** (auto · confirm · strict)
- `/work` — **what kind of work you are doing** (the seven above)

If you have explicitly set `/think` or `/mode`, your choice wins. A work mode never
overrides something a person chose.

> **More** — Switching by itself (Auto mode)
>
> **[The screen read →](docs/en/interface.md#work-modes)**

---

## Simple vs developer

Twenty commands on first launch means nothing gets chosen. Locking features away means
hitting a wall later. So only **what is shown** differs.

| | Simple (default) | Developer |
|---|---|---|
| `/help` listing | Common commands only | Everything |
| Error messages | What to do about it | The original text |
| Safety | **Identical** | **Identical** |

`/level developer` is saved to config and persists across sessions.

Two things matter here:

- **Hidden commands still work.** `/think high` works in simple mode. It just isn't listed.
- **Beginners do not get fewer safeguards.** Undo, workspace scope and dangerous-command
  blocking are identical. A beginner needs the undo more, not less.

> **More** — The input box · You don't have to type the whole command · The box stays while it works · The picture on the left moves too and 1 more
>
> **[The screen read →](docs/en/interface.md#simple-vs-developer)**

---

## Tools

Names and arguments match Claude Code, so skills written for that convention work unchanged.

| Tool | What it does |
|---|---|
| `Read` | Read a file (line numbers, `offset`/`limit`, **Excel as CSV, hwpx/docx/pptx and PDF as text**) |
| `Write` | Write / overwrite a file (**several at once via the `files` array**) |
| `Append` | Append to the end of a file — **how large files get written in pieces** |
| `Edit` | Replace an exact string (`replace_all`; **several sites at once via the `edits` array**) |
| `Move` | Move / rename files and folders — **how you restructure** (`moves` array; covered by undo) |
| `Glob` | Find files by name pattern |
| `Grep` | Regex search file contents |
| `Bash` | Run a command (**`background: true` for anything that does not finish**) |
| `Skill` | Expand a skill body (shown to the model only when skills exist) |
| `WebFetch` | Read a web page (read-only; hidden under `--offline`) |
| `Ask` | **Ask you back** at a fork — offers the choices, takes a single number |
| `Recall` | Search **past conversations** — the model digs up "that thing last time" itself |
| `Remember` | One line that outlives the session — known from the start next time |
| `TodoWrite` | Checklist — breaks long work into steps and shows progress |
| `Outline` | See a folder's **skeleton only** — tens of times cheaper than reading it whole |
| `Verify` | Check that what was built **actually works** |
| `Task` | Run one chunk of a big job in a **separate context** |
| `Jobs` | Inspect, read and stop **background commands** — the other half of `Bash`'s `background` |
| `Def` | **Where a name is defined** — only shown when a language server is installed |
| `Refs` | **Every place a name is used** — only shown when a language server is installed |

Nine tools here are not in Claude Code — `Append`, `Move`, `Ask`, `Recall`, `Remember`,
`Outline`, `Verify`, `Task`, `Jobs`. Each tool costs 150-400 tokens of schema on **every request**,
so a test stops you every time the list grows (`test/loop.test.js`). The last four earned
their cost; here is why.

> **More** — Outline · Verify · Task · Def · Refs · Commands that never finish and 9 more
>
> **[Tools in depth read →](docs/en/tools.md#tools)**

---

## Korean text and Excel

**A file saved as CP949 is written back as CP949.** The encoding is never changed.
Excel (`.xlsx`) is read as CSV — read-only.

Old formats (`.ppt`, `.doc`, `.xls`, `.rtf`) are read by **borrowing the LibreOffice already
on this machine** — the same terms on which deel borrows `rg`, and nothing is ever installed.
With no converter it **says so definitively and stops**: what is missing, what you can do about
it, and not to open the file again. Turn it off with `DEEL_CONVERT=off`.

> **More** — Encoding · Excel · borrowing a converter
>
> **[Korean documents and Excel read →](docs/en/documents.md#korean-text-and-excel)**

---

## Serving what you built

```
❯ /preview

  ▶ Serving  http://127.0.0.1:56801/
  showing .
  Edit a file and the page reloads by itself.
  Only this machine can open it (127.0.0.1). No other PC can see it.
  Stop with /preview off  · it shuts down when deel exits.
```

A browser opens with it. `/preview <folder>` picks what to serve, `/preview off` stops it.

**This is not the same as double-clicking the file (`file://`).** Under `file://` everything
below is blocked — and the error only shows up in the console while the page stays blank, so
you end up suspecting your own code. This is a real HTTP server, so it all works:

| | `file://` | `/preview` |
|---|---|---|
| `<script type="module">` · `import` | blocked (CORS) | **works** |
| `fetch('./data.json')` | blocked | **works** |
| `new Worker(...)` | blocked | **works** |
| `WebAssembly.compileStreaming` | blocked (MIME) | **works** |
| textures · `getImageData` | tainted canvas | **works** |
| `.glb` / `.gltf` (Three.js) | no MIME type → silently not drawn | **works** |

All seven were run in a real Chrome and confirmed **7/7**.

Apps with a router (React Router and friends) get the first page back when you reload on a
deep link. Never for requests with an extension (`app.js`) though — returning HTML for a
missing script dies with `Unexpected token '<'`, which hides the real cause (a typo in a filename).

### It opens exactly as much as it says

Starting a server means opening your disk to somebody else.

- Bound to **`127.0.0.1` only**. `0.0.0.0` is not available at all — on an office network
  that would let anyone read your source.
- Port **0** (the kernel hands out a free one). A fixed port steals someone else's.
- Paths cannot leave the working scope. `../` · `%2e%2e` · double encoding · absolute paths ·
  null bytes · symlinks — eight of these are held shut by tests.
- **It only serves.** `POST` · `PUT` · `DELETE` are refused with 405.
- It shuts down when `deel` exits.

---

## Skills and plugins

**deel does not carry skills with it.** On startup it scans the machine it is running on and uses
whatever is there. On a clean PC: zero. On a PC with skills installed: those skills.

```
project  ./.deel/skills   ./.claude/skills   ./.deel/commands   ./.claude/commands
user     ~/.deel/skills   ~/.claude/skills   ~/.claude/commands
plugins  ~/.claude/plugins/**   ~/.deel/plugins/**
```

Reads the Claude Code format: `SKILL.md` with YAML front matter, `commands/*.md`, `$ARGUMENTS`.

> **More** — Loaded in three stages · Fetching plugins · Deliberately not included
>
> **[Extending read →](docs/en/extend.md#skills-and-plugins)**

---

### The hidden latency of local models — keeping the prefix cache alive

Ollama and llama.cpp reuse computation **only while the request starts the same way as the
last one.** Change one early character and everything after it — the entire conversation —
is recomputed. This is the usual hidden reason long local sessions feel slower and slower,
and it never shows up anywhere, because it is not an error.

deel routes every message to the right mode automatically, and that mode instruction used to
sit **early** in the prompt — every mode switch broke the whole cache. So the stable parts
(rules, folder, project fingerprint, user rules, memory, skills) are frozen at the front and
the per-turn parts (mode, pins) go last. A test pins this order down (`test/cache.test.js`).

Ollama also gets `keep_alive: 60m` — with the 5-minute default, the model unloads while you
glance at another window, and the first message after you come back recomputes everything.
Override with `DEEL_KEEP_ALIVE`. If you run llama.cpp directly, `--cache-reuse 256` on the
server side does the same job.

## Reasoning effort

One answer means several model calls, and **each needs a different amount of thinking.**
All-high is slow; all-low wanders off.

The default is **one line**. What you want to know is how hard it is thinking right now,
not a stage table.

```
$ /think

  Effort  medium   (First call medium · Continue low · Stuck high)
  harder /think high   faster /think low
```

| Profile | Character |
|---|---|
| `even` | Same effort everywhere — predictable, slower |
| `save` (default) | Hard on the first decision only |
| `deep` | Everything one notch up — for hard work |

Set the profile with `/think profile save`. **Level and profile are different axes, so the
commands were split** — `/think high` and `/think save` used to set different things under
one name, which made the screen unreadable.

The stage table moved to `/think detail` (the default at developer level).

```
$ /think detail

  Effort  medium   (First call medium · Continue low · Stuck high)
  Profile   save   Hard on the first call, shallow while continuing - usually the better trade

  Stage       Effort    Out cap   When
  First call  · medium      14,069  Deciding what to do
  Continue    ↓ low         12,310  Reading a tool result, picking the next move
  Stuck       ↑ high        15,827  The last tool returned an error

  Caps are shared inside 16,384 (unknown, so a default) — /out
  Context 40,960 · used 5,787
```

That second-to-last line exists for a reason: **when all three caps are equal, it is the
only thing that says whether that is correct.** A low known cap makes them equal, and that
is fine. For a while all three read `16,384` always — which meant the table said nothing.

> **More** — Context length is read off the model · /out · Truncated tool calls
>
> **[Speed and spend read →](docs/en/tuning.md#reasoning-effort)**

---

## Auto-compaction

At 80% context, older turns are **summarised and folded** so work continues.
Plain truncation makes the model forget: it re-reads files and re-fixes what it already fixed.

```
  ◱ Folded 44 turns into a summary — 10,399 → 3,170 tokens (70% smaller)
```

The summary keeps goal / done / learned / decided / remaining. The cut point is chosen so a
**tool call is never separated from its result** — splitting them makes the server return 400.
If the summary request fails, it falls back to plain trimming rather than stopping.

`/compact` folds on demand.

---

## Resuming a conversation

Close the terminal by accident, or reboot, and the conversation is still there.
Messages are written to `.deel/sessions/` **as each one completes**, so a crash
loses at most the message in flight.

```
$ deel sessions

── conversations in this folder ────────────────────────────────
  ● 20260824-090200  just now    1 turn   devstral-small-2507
      fix the failing test
  · 20260824-084500  2h ago      2 turns  qwen2.5-coder:7b
      switch src/a.js logging to the logger
```

| Command | What it does |
|---|---|
| `deel --continue` | Resume the most recent conversation in this folder |
| `deel --resume <id>` | Resume a specific one |
| `deel sessions` | List what is stored |
| `deel sessions --rm <id>` | Delete one |

The format is `jsonl` — one message per line — so a power cut costs only the last line.
Resumed history keeps tool calls paired with their results, so work continues immediately.
Conversations older than 30 days and outside the most recent 30 are pruned automatically.

Everything lives in `.deel/sessions/` inside the working folder, and `.gitignore`
covers `.deel/` so it never reaches a repository.

---

## Starting over (`deel reset`)

Switching gateways, learned facts that went stale, handing the machine to someone else —
sometimes you want to go back to the beginning. Reinstalling does not do it: `~/.deel`
survives an install. Hence a command of its own.

```
$ deel reset

── what can be wiped ──────────────────────────────────────────
  home            C:\Users\me\.deel
  working folder  C:\work\myproject

  connections                        2
  memory                             8 lines
  conversations                     14
  learned                            2 places
  evidence, exports, temp            6
  plugins                            3
  sealed key                             DPAPI — this PC, this account only

── what is kept ───────────────────────────────────────────────
  undo snapshots                    41  needs all --hard
  audit log                      1,203 lines  needs all --hard
  written by you                         .deel/mcp.json · .deelignore
     never touched, by any route.
```

**Bare `deel reset` wipes nothing.** It shows what exists and asks.

| Command | What goes |
|---|---|
| `deel reset model` | connections and profiles, plus the key in the OS keystore |
| `deel reset memory` | memory (`.deel/memory.md`) |
| `deel reset sessions` | conversation history |
| `deel reset learned` | learned facts (this PC + this folder) |
| `deel reset plugins` | installed plugins |
| `deel reset all` | everything above **except plugins** |
| `deel reset all --hard` | plus undo snapshots and the audit log |
| `--yes` | skip the question (scripts, first-time provisioning) |

What it does **not** touch matters more.

| Kept | Why |
|---|---|
| `.deel/history/` (undo snapshots) | This is the safety net offered in place of an approval prompt. `--hard` only |
| `.deel/audit.jsonl` | The evidence for an internal review. `--hard` only |
| `.deel/mcp.json` · `.deelignore` · `DEEL.md` | You wrote these by hand. **Never touched, by any route** |
| Everything else in the working folder | Nothing outside `.deel` and the home folder is ever reached |

It runs on a broken config. That is usually *why* someone reaches for a reset, so
`deel reset` starts without reading the connection — the same reason `deel --version` answers
without one. Plugins take time to fetch again, so they stay out of `all`; ask for them by name.

---

## Attaching tools from outside (MCP)

A corporate wiki search, an issue tracker, a DB query tool — if a team publishes one as an MCP
server, deel uses it as a tool **without a code change**.

Configure in `.deel/mcp.json`. A Claude Code config can be copied over verbatim:

```json
{ "mcpServers": { "wiki": { "command": "node", "args": ["wiki-mcp.js"] } } }
```

The model sees it as `mcp__wiki__search`. `/mcp` shows what is attached.

**Dependencies stay at zero.** The stdio transport is nothing but newline-delimited JSON-RPC
2.0 over a child process's stdin/stdout, so `child_process` and `JSON` cover it. No SDK.

> **More** — But this is somebody else's program
>
> **[Extending read →](docs/en/extend.md#attaching-tools-from-outside-mcp)**

---

## Inside your editor (ACP)

A tool that makes you open one more terminal window stops being used after about two weeks.
Developers live inside the IDE. So deel speaks **ACP** (Agent Client Protocol) — Zed,
JetBrains, Neovim and Emacs attach to it **without changing a line on their side**.

One command in your editor's settings:

```
deel acp
```

The editor spawns that as a child process and exchanges newline-delimited JSON-RPC 2.0 over
stdio. It is not a command you type yourself.

**What you get once it is attached:**

| In the editor | From deel |
|---|---|
| Streaming reply pane | The model's text and its reasoning |
| Tool list with icons and status | `Read` is a read, `Edit` is an edit, `Bash` is an execution — **the kind is sent**, not just a name |
| Clickable file links | The **absolute path** of every file touched |
| Approval dialog | deel's safety rails, rendered as the editor's own prompt (`allow once` · `always allow` · `reject`) |
| Mode picker | deel's seven work modes (auto · code · plan · architect · debug · ask · orchestrator) |
| Stop button | Reaches the turn mid-flight, even while waiting on the model |
| Past conversations | Still there after a restart. They live in the **same place** as the terminal's, so a session started in the editor can be picked up with `deel --resume` |

**Still zero dependencies.** Same reason as MCP — newline-delimited JSON-RPC 2.0 is the whole
transport, so no SDK is needed.

> **More** — Details — the places this breaks silently
>
> **[Extending read →](docs/en/extend.md#inside-your-editor-acp)**

---

## Keeping secrets out of the conversation

People rarely paste a key. The leak is almost always **command output**.

```
env                  OPENAI_API_KEY=sk-proj-…
git remote -v        https://user:token@github.com/…
curl -v              > Authorization: Bearer eyJ…
a failing test log   the whole connection string
```

That text goes to the model **and** gets written to `.deel/sessions/*.jsonl` on disk. That
file is later re-read by `/recall` and can end up inside a `deel pack` bundle. Leak once and
you have several copies.

So it is masked at the single point where tool output enters the conversation.

```
  ⏺ Bash(env | grep API)  done
    ⊘ 2 secret-looking values entered the conversation (openai · env var) — masked before the model
```

What it looks for: private-key blocks · OpenAI/Anthropic keys · GitHub tokens · Slack tokens ·
AWS keys · Google keys · JWTs · credentials embedded in URLs · `Authorization`-family headers ·
env vars named `…KEY` / `…TOKEN` / `…SECRET` / `…PASSWORD`. Plus **the configured gateway key
regardless of its shape** — that one is not a guess, it is a known value.

### File contents are deliberately not masked

`.env` is exactly where masking feels most tempting, and exactly where it backfires: the model
sees the masked text, edits it, writes it back — and `«가림»` lands where the real key was.
**Protecting the secret would destroy it.**

So on the file side it reports instead of rewriting.

```
  ⏺ Read(.env)  12 lines
    ! 3 secret-looking values entered the conversation (env var)
      — file contents are not masked (masking them would erase the key on write-back)
```

Saying plainly what cannot be stopped beats claiming it was stopped while corrupting the file.
Either way it lands in the audit log.

---

## Safety

Instead of approval prompts, the design makes things **reversible**. The default `auto` mode
does not ask.

| Mechanism | Detail |
|---|---|
| **Undo** | Snapshot before every write. `/undo` restores per turn. **Includes moves and deletes done through `Bash`** |
| **Change display** | The changed lines are shown on every edit; `/diff` for the whole session |
| **Scope** | Outside the starting folder is refused, even if the model insists |
| **Blocked commands** | Only irreversible ones (disk format, recursive delete, `--force` push) |
| **No re-run** | A mutating command is never retried after failure |
| **Interrupt** | Ctrl+C stops mid-answer and leaves the conversation valid |
| **Spin guard** | Three identical failures stop the turn, with the reason |
| **Not read** | Other tools' private stores, and deel's own logs and config (the key), are refused |
| **Audit log** | Everything recorded in `.deel/audit.jsonl` |

| Mode | Asks when |
|---|---|
| `auto` (default) | Never — undo is the safety net |
| `confirm` | Irreversible commands only |
| `strict` | All file changes and commands |

Undo history stores whole file contents, so repeated edits to large files add up. Past 32MB
it keeps the **most recent 50 turns** and drops the rest. What you just did is always
undoable; `/status` shows how large the history currently is.

> **More** — Files removed through Bash come back too · What it will not read
>
> **[Safety and corporate review read →](docs/en/safety.md#safety)**

---

## Corporate review package

```bash
deel pack --out deel-import.zip
```

```
  ✓ deel-import.zip
     94 files · 509.6KB

  Dependencies      0
  Install scripts   none
  External imports  0
  Network calls     3 sites (configured address only)
  Ports opened      1 site (/preview only)
```

The zip carries **one document for people and two for machines.** A corporate review is
not a human-only process — security feeds an SBOM to a scanner, and operations reads the
audit-log spec to write SIEM ingestion rules.

| File | What |
|---|---|
| `import-review.txt` | Dependencies · install scripts · **every network and process-spawn call site found by scanning the source** (file:line) · the three outbound lanes · SHA-256 per file |
| `sbom.cdx.json` | **SBOM (CycloneDX 1.5).** Feed it straight to a scanner. One component per file with SHA-256; dependencies stated as an **explicit empty array** — "not declared" and "none" are different claims |
| `audit-spec.json` | Egress list (per lane: when, where, what, how it's stopped, and the source location) · **audit-log spec** (field names and meanings, plus what is never recorded) · file hashes |

```bash
deel audit                    # the human-readable sheet only
deel sbom                     # the two machine-readable ones, on stdout (deel sbom | jq)
deel sbom --out review.json   # to a file
deel sbom --only sbom         # just the SBOM
```

With the screen language set to English these three, and the `deel pack` archive itself,
come out in English — file names included (`deel pack` writes `deel-import.zip`).

All three are generated by scanning the source, never written by hand — hand-written sheets
drift, and **a review document that drifts is worse than none.** Find one wrong line and the
reviewer stops trusting the rest. The audit-log spec is the one hand-written part, so a test
checks it against real log records on every run.

> **More** — Diagnosing a corporate gateway
>
> **[Safety and corporate review read →](docs/en/safety.md#corporate-review-package)**

---

## Configuration

Stored in `~/.deel/config.json`. A `.deel/config.json` in the project folder takes precedence.

> **More** — Supported servers · Environment variables · Flags · Project rules
>
> **[Configuration read →](docs/en/config.md#configuration)**

---

## Troubleshooting

| Symptom | Check |
|---|---|
| `address not found` | Typo, DNS, VPN / intranet connectivity |
| `connection refused` | Server is down or the port differs |
| certificate error | `set NODE_EXTRA_CA_CERTS=C:\path\corp-ca.pem` |
| behind a proxy | `set HTTPS_PROXY=http://proxy:port` (with auth: `http://user:pw@proxy:port`). If the first screen and `/status` show `proxy …`, it is in use. Exclude hosts with `NO_PROXY=.corp.com,10.1.2.3`; turn it off entirely with `"proxy": "none"` in the config |
| the proxy answers 407 | Put `user:pw@` into the proxy address. Proxies that only accept NTLM · Negotiate are not supported — ask the admin for Basic or an unauthenticated address |
| 401 / 403 | Wrong key or auth header style (four are tried automatically) |
| `address not permitted` | The lock did its job — pick a connection with `/model` |
| Tool calls don't work | Run `deel diagnose`. Small models (1B–3B) often can't |
| Empty replies | The server ignores streaming. deel retries once, then turns streaming off for the session |
| Large files cut off mid-write | Check `/out` and raise it — the cap may be sitting at the 16,384 default because it could not be discovered |
| Only `HTTP 400` shows | The server's own message is shown verbatim. If it is a length problem the number is read and applied automatically |
| `429` · `503` shows | The gateway pushed back for a moment. deel waits and calls again, up to three times (honouring `Retry-After`). If it keeps happening, check your quota |
| `deel scan` finds nothing | Server is off or on another port — use `--ports` |

---

## Development

```bash
npm test          Full suite (~5,890 checks; a few are TTY-dependent)
npm run coverage  Which lines the tests actually execute
npm run verify    Import + network checks only
npm run bench     Edit success rate
npm run demo      See what the UI actually looks like
npm run check     Syntax check every file
```

Tests run against a **fake gateway**, so the loop, streaming, tool execution, undo and compaction
are verified deterministically without any model. ZIP output is cross-checked with the real
`unzip`; the TAR reader is fed archives produced by the real `tar`.

`npm test` runs each file separately and reports **per-file exit codes**, because the exit code
— not the pass marks on screen — is what CI reads, and the two can disagree: a file can pass
every check and still die on the way out, leaving the screen green and the exit code 1. That
happened once on Windows and cost a lot of time. The runner does not stop at the first failure,
so one run tells you everything.

| Suite | Checks | Covers |
|---|---|---|
| `smoke` | 20 | Tools, scope, undo, audit log |
| `loop` | 16 | Agent loop, streaming, tool calls |
| `guard` | 24 | **What it refuses to do** — denied edits, unknown tools, repeated mutations, out-of-scope writes |
| `network` | 30 | Nothing escapes the configured address |
| `web` | 25 | Web reads stay read-only |
| `abort` · `steer` | 16 · 15 | Ctrl+C leaves the conversation valid · a line typed mid-turn rides the next call |
| `parallel` | 23 | Read-only tools run together; checklists |
| `cli` | 75 | **Spawns the real `deel`** and drives it to completion |
| `setup` | 42 | First-run wizard, driven through a fake TTY |
| `detect` | 66 | Identifying shape and auth from one address |
| `modes` · `route` | 89 · 33 | Work modes; auto-switching from Auto |
| `ctxsize` | 43 | Reading context length off the model |
| `commands` · `commands-more` | 128 · 62 | Every slash command |
| `ui` · `ui2` | 60 · 40 | Password masking, CJK width, status line, session list, Excel→text |
| `encoding` · `xlsx` | 68 · 72 | Legacy-encoding detection; Excel reading |
| `compact` | 21 | Summary folding, pairing intact, graceful fallback |
| `store` | 34 | Session persistence, resume, crash recovery |
| `scan` | 29 | Distinguishing multiple runtimes |
| `plugins` | 38 | Plugin fetch/pack, ZIP/TAR |
| `no-bundle` | 12 | Nothing foreign in the published package; test-file hygiene |
| `edit-bench` | 20 cases | Edit success rate |

> **More** — Coverage · Layout
>
> **[Development read →](docs/en/develop.md#development)**

---

## Release notes

| Version | What changed |
|---|---|
| **[1.10.0](docs/en/releases/1.10.md#1100)** | ESC actually stops · a full context carries on inside the same turn · every vendor endpoint measured |
| [1.9.2](docs/en/releases/1.9.md#192) | Guards that said they were blocking were not blocking · folding lost the request and the outstanding work |
| [1.9.1](docs/en/releases/1.9.md#191) | MCP tools with Korean names all looked the same to the model — names are now distinct and stable |
| **[1.9.0](docs/en/releases/1.9.md#190)** | Tables are drawn as tables · reasoning effort reaches Claude and Bedrock · tool schemas shaped per vendor · only the changed part of a file is re-sent |
| **[1.8.0](docs/en/releases/1.8.md#180)** | A full day against a gateway that hands out one-hour tokens — fetch the key instead of storing it · `deel reset` · an English screen that is actually English |

The five most recent are listed here. Every version, and why each thing changed, is in the **[release notes](docs/en/releases.md)**.

---

## Licence

[MIT](LICENSE)
