<div align="center">

# deel

**A coding-agent CLI that runs on local models and private gateways only**

Zero dependencies · Node 20+ · Exactly one place your source can go

[한국어](README.md) · [Corporate review](#corporate-review-package) · [Troubleshooting](#troubleshooting)

</div>

---

```
 ╭──────────────────────────────────────────────────────────────╮
 │ deel  OpenAI-compatible                                      │
 │                                                              │
 │ Model    qwen2.5-coder:7b  (40k tokens)                      │
 │ Sends to this machine 127.0.0.1:11434  ← nowhere else        │
 │ Link     streaming · tools · reasoning control               │
 │ Folder   C:\work\myproject                                   │
 │ This PC  337 skills · 127 commands · 42 plugins              │
 ╰──────────────────────────────────────────────────────────────╯

 ▏myproject ▏qwen2.5-coder:7b ▏▰▰▱▱▱▱▱▱▱▱ 22% 28k/128k ▏◇ medium·save ▏auto
 ❯ unify the logging style

  ❊ Grep(console.log)
    └ 1 file · 1 hit
  ◧ Read(src/runner.js)
    └ 5 lines
  ◈ Edit(src/runner.js)
    └ 1 spot

  Unified log calls to the logger format. One change in runner.js.

  ── 4.2s · 3 tools · ↑3,900 ↓180
```

---

## Contents

- [Why this exists](#why-this-exists)
- [Quick start](#quick-start)
- [Where your data can go](#where-your-data-can-go)
- [Multiple local runtimes](#multiple-local-runtimes)
- [Slash commands](#slash-commands)
- [Work modes](#work-modes)
- [Simple vs developer](#simple-vs-developer)
- [Tools](#tools)
- [Korean text and Excel](#korean-text-and-excel)
- [Skills and plugins](#skills-and-plugins)
- [Reasoning effort](#reasoning-effort)
- [Auto-compaction](#auto-compaction)
- [Resuming a conversation](#resuming-a-conversation)
- [Safety](#safety)
- [Corporate review package](#corporate-review-package)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

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

## Quick start

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
```

Pass `--offline` and **both B and C are closed** — traffic stays on this machine.

```bash
deel --offline
```

The destination is printed at the top of every session:

```
 Sends to this machine 127.0.0.1:11434  ← nowhere else
```

Nothing is collected or transmitted. No telemetry, no usage stats, no crash reporting.
Conversation history, undo snapshots and config live only in `.deel/` inside your working folder.

> Verified by 55 checks in `npm test` (network + web), including bringing up a real server and
> confirming that **not a single request reaches it** when it is not allow-listed.

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

---

## Slash commands

Names follow Claude Code / Codex conventions.

| Command | What it does |
|---|---|
| `/help` | Command list |
| `/context` | What is consuming the context window |
| `/ctx [auto\|number]` | Context **length** — re-read it off the model, or set it yourself |
| `/compact` | Summarise and fold older turns |
| `/clear` | Clear the conversation (keeps link and rules) |
| `/model` | Switch connection / model |
| `/think <level\|profile>` | `off·low·medium·high·max` or `even·save·deep` |
| `/mode <mode>` | Approval policy — how much it asks (`auto` · `confirm` · `strict`) |
| `/work [mode]` | Work mode — what kind of work you are doing |
| `/auto` | Hand the wheel back — it picks the mode from what you type |
| `/code` `/plan` `/architect` `/debug` `/ask` `/orchestrator` | Switch work mode directly (pins it) |
| `/level [level]` | How much to show (`쉬움` simple · `개발자` developer) |
| `/undo [turns]` | Revert file changes |
| `/tools` | Available tools |
| `/skills [query\|all\|off]` | Browse, search, load skills |
| `/plugin [install\|remove\|pack]` | Manage plugins |
| `/cost` | Session usage |
| `/status` | Connection status |
| `/scan [save]` | Sweep this machine for local model servers (`save` registers them) |
| `/sessions` | Past conversations in this folder |
| `/init` | Create a `DEEL.md` rules file |
| `/exit` | Quit |

Discovered plugin commands are invoked as `/<plugin>:<name>`, with `$ARGUMENTS` substituted.

`/scan` and `/sessions` work without leaving the session. If you just started another local
server or loaded a different model, `/scan save` then `/model` switches over without losing
the conversation.

### Interrupting

Press **Ctrl+C** to stop the model mid-answer when it is heading the wrong way.

```
❯ rewrite the whole test suite
  ◧ Read  test/smoke.js
  ◧ Read  test/loop.test.js
^C
  ⚠ Stopped (after step 2)

❯ ▊
```

The conversation stays valid. If the model had announced tool calls, each unanswered one is
filled with a `stopped by user` result so the call/result pairing holds — a conversation with
broken pairing is rejected with HTTP 400 on the next request, which would waste the whole
session. Tools already running finish; **tools not yet started never run.**

Pressing Ctrl+C again on an empty line quits.

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

### Switching by itself (Auto mode)

You start in **Auto**. Nothing has been decided about what kind of work is coming.
Every turn, deel reads what you typed, picks the mode that fits, and works in it.

```
❯ why won't the login go through?

  ◉ Debug   because your message contained "why won't", "won't"
  Not what you wanted? Type /code to pin a mode yourself.
```

Switching brings **the whole mode** with it — its working protocol, its tool set, its
reasoning settings. It isn't a label saying "debug mode": the model is actually walked
through symptom → reproduce → hypothesis → evidence, and in Plan mode `Write` and `Edit`
are not handed over at all.

| When you say | It goes to |
|---|---|
| why won't · error · fails · crashes · what's causing | ◉ Debug |
| plan · roadmap · what order · let's map it out first | ☰ Plan |
| design · architecture · how should this be structured · how to split | ◈ Architect |
| what is · explain · how does it work · difference between | ◇ Ask |
| all of · everything · one by one · to the end · unify | ❋ Orchestrator |
| fix · add · implement · rename · delete | ◆ Code |

**When it's close, it doesn't switch.** "ok", "go on", "that thing from earlier" leave you
in Auto. So does a near-tie between first and second place — a wrong switch into a read-only
mode leaves you blocked without knowing *why*. Read-only modes (Plan, Architect, Ask)
therefore carry a higher bar: "explain this and fix it" routes to Code, not Ask.

A switch lasts **one turn only.** The next message is judged fresh.
A `~` in the status line means it switched by itself; no `~` means you chose it.

```
◎ Auto         ← waiting
~◉ Debug       ← this turn only, chosen for you
◉ Debug        ← you typed /debug. It stays.
```

Choosing a mode yourself **pins** it. `/auto` (or `/work auto`) hands the wheel back.

---

## Simple vs developer

Twenty commands on first launch means nothing gets chosen. Locking features away means
hitting a wall later. So only **what is shown** differs.

| | Simple (`쉬움`, default) | Developer (`개발자`) |
|---|---|---|
| `/help` listing | Common commands only | Everything |
| Error messages | What to do about it | The original text |
| Safety | **Identical** | **Identical** |

`/level 개발자` is saved to config and persists across sessions.

Two things matter here:

- **Hidden commands still work.** `/think high` works in simple mode. It just isn't listed.
- **Beginners do not get fewer safeguards.** Undo, workspace scope and dangerous-command
  blocking are identical. A beginner needs the undo more, not less.

---

## Tools

Names and arguments match Claude Code, so skills written for that convention work unchanged.

| Tool | What it does |
|---|---|
| `Read` | Read a file (line numbers, `offset`/`limit`, **Excel as CSV**) |
| `Write` | Write / overwrite a file |
| `Edit` | Replace an exact string (`replace_all` supported) |
| `Glob` | Find files by name pattern |
| `Grep` | Regex search file contents |
| `Bash` | Run a command |
| `Skill` | Expand a skill body (shown to the model only when skills exist) |
| `WebFetch` | Read a web page (read-only; hidden under `--offline`) |
| `TodoWrite` | Checklist — breaks long work into steps and shows progress |

### Checklists

Keeps the model from losing its place on multi-step work. The list is redrawn whenever the
model updates it.

```
  ☰ Todo  1/3 done  ← just finished 1

    ✓ unify log format
    ▶ fix the tests
    ☐ update the docs
```

Only one item may be **in progress** at a time; setting two is refused. Holding several at
once is how nothing gets finished.

### Read-only tools run together

When the model asks for three `Read` calls at once, all three run **concurrently** — sweeping
five files costs about what reading one costs.

```
  ◧ Read  src/a.js    ◧ Read  src/b.js    ◧ Read  src/c.js     together
```

Only `Read`, `Glob`, `Grep`, `Skill` and `WebFetch` are eligible. `Write`, `Edit` and `Bash`
always run one at a time — two concurrent writes to one file scramble the undo snapshot
order, and `Bash` can do anything. Results come back **in the order the model asked for
them**, even when they finish out of order; shuffled results confuse the model about which
result belongs to which call.

### Edits survive small mistakes

Models routinely get whitespace, indentation and line endings wrong. deel relaxes matching in
stages but **refuses outright when the match is ambiguous** — silently editing the wrong place is
far worse than not finding it.

```
exact  →  ignore trailing space / CRLF  →  ignore indentation  →  ignore all whitespace
```

Measured with `npm run bench`:

| | Success | Wrong place edited |
|---|---|---|
| Exact match only | 20% | 0 |
| Staged relaxation | **100%** | **0** |

On failure it points at the closest line in the file.

---

## Korean text and Excel

### Encoding — written back the way it was read

Corporate documents are often not UTF-8. Files saved by old Windows Notepad in a legacy
codepage (CP949 in Korea, CP932 in Japan, GBK in China) are still around. Reading one as
UTF-8 garbles it completely: `한글` becomes `�ѱ�`.

Writing is the dangerous part. Read it garbled, save it as UTF-8, and the original is gone.
So there is one rule: **write it back in the encoding it was read in.**

Which encoding that is comes from **the file's contents, not the machine's settings.**
Each candidate is decoded strictly, then scored on whether the result looks like real text
written in that encoding. So the same CP949 document reads identically on Ubuntu, on a US
Windows machine, and on a Korean one.

```
› Read report.txt
└ 4 lines · CP949
```

If you try to insert a character that encoding **cannot hold**, it refuses instead of saving.

```
› Edit report.txt   note → note 🚀
└ This file is CP949, and you are inserting a character that encoding does not have: 🚀
```

Silently substituting question marks would be worse than not writing at all.
Newly created files are UTF-8.

Command output is handled the same way. A Windows console is not UTF-8, so taking `Bash`
output as utf8 garbles non-ASCII text. It is collected as bytes and decoded afterwards.

### Excel — read as CSV

An Excel file is a compressed archive, not text, so normally you get "this is a binary file"
and somebody has to export a CSV by hand. `Read` just does it.

```
› Read report.xlsx
└ 3 sheets · 128 rows · unpacked directly
```

- **Still zero dependencies.** An xlsx is a zip full of XML, so Node's built-in `zlib` is enough.
- Every sheet is returned. Hidden sheets too, marked as hidden.
- Dates come back as dates, not serial numbers — the cell format is read to decide.
- Formulas come back as **computed values**, and error values like `#REF!` are not dropped.

**Password-protected files and legacy `.xls`** are handed to Excel itself; those cannot be
unpacked directly. You are asked for the password at that point.

The password is **not stored anywhere**:

- not in the config file
- not in the session log
- not in the audit log
- not as a command-line argument (other people can see your command lines)

The only path out is the child process's stdin, and a test asserts that this stays true.
Extracted intermediate files are deleted after use.

> **Excel files are read-only here.** `Edit` and `Write` refuse them, and say why and what
> to do instead. Round-tripping a file with formatting, formulas and charts through CSV
> always loses something. Better not to write than to write knowing you'll lose data.

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

### Loaded in three stages

Loading everything would blow the context window.

| Stage | What | Cost |
|---|---|---|
| 1 | Name + one-line description in the prompt | ~1,800 tokens for 40 skills |
| 2 | Body of the one the model picks via `Skill` | one at a time |
| 3 | Files that body references, via `Read` | on demand |

### Fetching plugins

```bash
# on a connected machine
/plugin install affaan-m/ECC       # git clone, or tarball when git is absent
/plugin pack import.zip            # bundle, excluding executable scripts

# on the air-gapped machine — just unzip
unzip import.zip -d ~/.deel/plugins/
```

`/plugin pack` omits `.js` `.sh` `.ps1` `.py` and friends, and includes a plain-text manifest
with a licence table — ready to hand to a security reviewer.

### Deliberately not included

| | Why |
|---|---|
| hooks | Executable scripts — fails import review, widens the blast radius of autonomy |
| sub-agents | Doubles model calls against a gateway quota |
| MCP | A separate protocol; a project of its own |

---

## Reasoning effort

One answer means several model calls, and **each needs a different amount of thinking.**
All-high is slow; all-low wanders off.

```
$ /think

  Base medium   Profile save   Hard on the first decision, light while continuing

  Stage         Effort    Cap     When
  first call    · medium   4,096  deciding what to do
  continuing    ↓ low      2,048  reading a tool result, picking the next step
  stuck         ↑ high     4,096  the previous tool errored
```

| Profile | Character |
|---|---|
| `even` | Same effort everywhere — predictable, slower |
| `save` (default) | Hard on the first decision only |
| `deep` | Everything one notch up — for hard work |

### Context length is read off the model

This one number sizes the whole program: how many files fit in one read, when the
conversation gets folded, how long a single reply may be — **all of it comes from here.**

So deel asks the server on every launch rather than trusting the saved value. The same
model name can be loaded at a different length each time, and if that difference never
reaches the screen there is no way to notice. **It just quietly gets smaller.**

```
 │ Model    qwen3-coder  (640k tokens)                     │
 ╰─────────────────────────────────────────────────────────╯
 ✓ Context adjusted 32,768 → 655,360 (read from LM Studio)
```

Every server puts this number under a different name in a different place, so deel checks
all of them.

| Server | Where it reads |
|---|---|
| LM Studio | `/api/v0/models` — `max_context_length`, `loaded_context_length` |
| llama.cpp | `/props` — `n_ctx` |
| vLLM | `/v1/models` — `max_model_len` |
| Ollama | `/api/show` — `<model>.context_length` |
| Other OpenAI-compatible | `/v1/models/<model>` — `context_window`, `context_length`, `max_input_tokens`, `max_position_embeddings` (found even when nested) |

**Model maximum and loaded length are not the same thing.** LM Studio will happily load a
655,360-capable model at 8,192. Trusting the maximum there gets your requests rejected. So
the **loaded length is what deel uses**, and the maximum is reported separately.

```
 ⚠ This model goes up to 655,360 — raise it on the server, then /ctx auto
```

| Command | What it does |
|---|---|
| `/ctx` | Current length and remaining room |
| `/ctx auto` | Ask the server again and match the model |
| `/ctx 655360` | Set it yourself (`640k`, `128k`, `1m` also work) |
| `/ctx out 32k` | Cap on a **single reply** — a different axis from context |
| `deel --ctx 655360` | Start at this value (skips the lookup) |

**`k` means 1024 here.** Context lengths are all powers of two, so that is the only base
that lines up: 655,360 is `640k`, not `655k`; 131,072 is `128k`, not `131k`. The display and
`/ctx` use the same unit, so typing back what you see gives you the same number.

**Caps are not fixed numbers.** They are computed from the model's context window and how
much of it is currently used — the profile decides what share of the remaining room a stage gets.

| Model | First call | Continuing | Stuck |
|---|---|---|---|
| 2k local | 554 | 512 | 554 |
| 8k local | 2,007 | 1,003 | 2,007 |
| 40k (qwen3) | 11,688 | 5,844 | 11,688 |
| 128k gateway | 16,384 | 16,384 | 16,384 |
| 128k, 80% full | 7,680 | 3,840 | 7,680 |

Caps shrink as the context fills. Handing a 4k model a 4,096-token cap would leave no room for input.
Raise the ceiling with `maxTokens` in the profile if you need more.

If a saved cap truncates a reply, **that step alone is retried with the cap lifted.**
A truncated reply means a half-written tool call, which fails silently.

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

## Safety

Instead of approval prompts, the design makes things **reversible**. The default `auto` mode
does not ask.

| Mechanism | Detail |
|---|---|
| **Undo** | Snapshot before every write. `/undo` restores per turn |
| **Scope** | Outside the starting folder is refused, even if the model insists |
| **Blocked commands** | Only irreversible ones (disk format, recursive delete, `--force` push) |
| **No re-run** | A mutating command is never retried after failure |
| **Interrupt** | Ctrl+C stops mid-answer and leaves the conversation valid |
| **Audit log** | Everything recorded in `.deel/audit.jsonl` |

| Mode | Asks when |
|---|---|
| `auto` (default) | Never — undo is the safety net |
| `confirm` | Irreversible commands only |
| `strict` | All file changes and commands |

Undo history stores whole file contents, so repeated edits to large files add up. Past 32MB
it keeps the **most recent 50 turns** and drops the rest. What you just did is always
undoable; `/status` shows how large the history currently is.

---

## Corporate review package

```bash
deel pack --out deel-import.zip
```

```
  ✓ deel-import.zip
     39 files · 100.2KB

  Dependencies      0
  Install scripts   none
  External imports  0
  Network calls     3 sites (configured address only)
  Ports opened      none
```

The bundled review sheet contains:

- Dependency list and every external `import` in the source
- Presence of `preinstall` / `install` / `postinstall` / `prepare`
- **Every network and process-spawn call site found by scanning the source** (file:line)
- The three outbound lanes, explained
- SHA-256 per file (verify with `certutil -hashfile`)

It is generated by scanning the source, not written by hand — hand-written sheets drift from reality.
Use `deel audit` to read it without building a zip.

### Diagnosing a corporate gateway

```bash
node bin/deel.js diagnose --url <gateway> --key <key> --model <model> --out report.txt
```

Hand over `report.txt` alone — plain text, no colour codes.

| Check | Why it matters |
|---|---|
| Basic chat | Address, key and model name are right |
| System message | Rules (`DEEL.md`) and skills take effect |
| Streaming | Output can flow token by token |
| **Tool calls** | **Whether it can read and edit files — the critical one** |
| **Tool results** | **Whether multi-turn works — the premise of the agent loop** |
| Structured output | Edit format can be enforced by schema |
| Reasoning control | Whether `/think` works at the model layer |
| Context length | How many files can be read at once |

Verdict is one of **ready · limited · blocked · unreachable**.

---

## Configuration

Stored in `~/.deel/config.json`. A `.deel/config.json` in the project folder takes precedence.

### Supported servers

| | Example address |
|---|---|
| Corporate AI gateway (OpenAI-compatible) | `https://ai-gw.example.corp/v1` |
| Ollama | `http://localhost:11434` |
| LM Studio | `http://localhost:1234/v1` |
| llama.cpp · vLLM · LiteLLM | `http://host:port/v1` |

Auth style is detected automatically: `Authorization: Bearer` → `x-api-key` → `api-key` (Azure) → none.

### Environment variables

| Variable | Use |
|---|---|
| `DEEL_API_KEY` | Keep the key out of the config file (takes precedence) |
| `DEEL_KEY_<PROFILE_ID>` | Per-profile key |
| `NODE_EXTRA_CA_CERTS` | Corporate TLS certificate |
| `HTTPS_PROXY` | Behind a proxy |
| `DEEL_DEBUG=1` | Verbose errors |
| `NO_COLOR` | Disable colour |

### Flags

```bash
deel --root <folder>     Working scope. Defaults to the current folder
deel --mode <mode>       auto (default) / confirm / strict
deel --work <mode>       auto (default) / code / plan / architect / debug / ask / orchestrator
deel --level <level>     쉬움 (simple) / 개발자 (developer)
deel --think <level>     off / low / medium (default) / high / max
deel --effort <profile>  even / save (default) / deep
deel --offline           Nothing leaves this machine
deel --continue          Resume the most recent conversation
deel --resume <id>       Resume a specific one
```

### Project rules

If the working folder has `DEEL.md`, `CLAUDE.md` or `AGENTS.md`, it is loaded as project rules.
`/init` scaffolds one.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| `address not found` | Typo, DNS, VPN / intranet connectivity |
| `connection refused` | Server is down or the port differs |
| certificate error | `set NODE_EXTRA_CA_CERTS=C:\path\corp-ca.pem` |
| behind a proxy | `set HTTPS_PROXY=http://proxy:port` |
| 401 / 403 | Wrong key or auth header style (four are tried automatically) |
| `address not permitted` | The lock did its job — pick a connection with `/model` |
| Tool calls don't work | Run `deel diagnose`. Small models (1B–3B) often can't |
| Empty replies | A heavy-reasoning model — try `/think low` |
| `deel scan` finds nothing | Server is off or on another port — use `--ports` |

---

## Development

```bash
npm test        Full suite (254 checks)
npm run verify  Import + network checks only
npm run bench   Edit success rate
npm run demo    See what the UI actually looks like
npm run check   Syntax check every file
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
| `network` | 30 | Nothing escapes the configured address |
| `web` | 25 | Web reads stay read-only |
| `abort` | 16 | Ctrl+C leaves the conversation valid |
| `parallel` | 23 | Read-only tools run together; checklists |
| `compact` | 21 | Summary folding, pairing intact, graceful fallback |
| `store` | 34 | Session persistence, resume, crash recovery |
| `scan` | 19 | Distinguishing multiple runtimes |
| `plugins` | 38 | Plugin fetch/pack, ZIP/TAR |
| `no-bundle` | 12 | Nothing foreign in the published package; test-file hygiene |
| `edit-bench` | 20 cases | Edit success rate |

---

## Licence

[MIT](LICENSE)
