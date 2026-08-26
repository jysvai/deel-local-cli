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
 │ Approval ⏵⏵ 자동 승인  — nothing is asked; /undo is the net   │
 │          Shift+Tab to change  ·  Tab completes a / command   │
 │ This PC  337 skills · 127 commands · 42 plugins              │
 ╰──────────────────────────────────────────────────────────────╯

 ▏myproject · qwen2.5-coder:7b ▏ ▰▰▱▱▱▱▱▱▱▱ 22% 28k/128k ▏ ◎ 종합 · ◇ medium·절약 · ⏵⏵ 자동
 ❯ unify the logging style

  ❊ Grep(console.log)
    └ 1 file · 1 hit
  ◧ Read(src/runner.js)
    └ 5 lines
  ◈ Edit(src/runner.js)
    └ 1 spot

  ▌ Unified log calls to the logger format. One change in runner.js.

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
- [Serving what you built](#serving-what-you-built)
- [Skills and plugins](#skills-and-plugins)
- [Reasoning effort](#reasoning-effort)
- [Auto-compaction](#auto-compaction)
- [Resuming a conversation](#resuming-a-conversation)
- [Attaching tools from outside (MCP)](#attaching-tools-from-outside-mcp)
- [Safety](#safety)
- [Corporate review package](#corporate-review-package)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

Each section is open at the summary. Click **▸ More** to unfold the detail behind it.

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

<details>
<summary><b>More</b> — It adapts to whatever model is attached · Small windows get a smaller fixed share · On startup it reads what kind of project this folder is</summary>

### It adapts to whatever model is attached

If you move between models, any number tuned for one of them is wrong for all the others.
So **no number is hardcoded.**

There are two axes. They are easy to confuse, so they have separate commands.

| | What it measures | Command |
|---|---|---|
| **Window size** | how much it can hold | `/ctx` |
| **Model grade** | how much it can do on its own | `/grade` |

They do not move together. A 3B model with a 128k window exists; so does a very good model
with 32k. Treat them as one axis and you hold one back while overrunning the other.

**Derived from window size** (`src/agent/budget.js`):

| | 8k | 32k | 131k | 655k |
|---|---|---|---|---|
| Steps per turn (code) | 16 | 48 | 192 | 200 |
| `Read` lines | 200 | 384 | 1,536 | 4,000 |
| `Glob` results | 50 | 192 | 768 | 1,000 |
| `Outline` lines | 120 | 480 | 1,920 | 2,500 |
| `WebFetch` chars | 4,000 | 12,800 | 51,200 | 120,000 |
| Subtask summary | 400 | 1,600 | 4,000 | 4,000 |

**Derived from model grade** (`src/agent/grade.js`):

| | small | medium | large |
|---|---|---|---|
| Files per `Write` | 3 | 6 | 12 |
| Split-writing threshold | 200 lines | 400 lines | 800 lines |
| Spell out the procedure | yes | yes | **no — give the goal** |
| Require verification | yes | yes | **yes** (grade-independent) |

The grade is decided like this:

1. **First guess from the name.** `qwen2.5-coder-7b` -> small, `llama-3.3-70b` -> large.
   Version numbers (`2.5`) and quantisation tags (`q4_k_m`) are not read as sizes.
   A name that says nothing means **medium**, not small — a corporate gateway is exactly
   that case, and the models behind one are usually big. Guessing small holds them back.
2. **Corrected by what actually happened.** Truncated tool arguments, empty answers,
   failed edits and repeats are counted. A model labelled 70B that truncates every step is
   dropped to **small**; a 7B that runs ten clean steps is raised one level. The name is a
   guess; what happened is a fact.
3. **You win if you say so.** `/grade large`, and `/grade auto` hands it back.

The status line shows `◈ small?`. The question mark means **still a guess** — a guess is
not presented with the same face as something measured.

The grade only changes **how much hand-holding you get**. Working scope, approval mode,
undo and the audit log are identical at every grade. There is no "it is a good model, so
skip verification" — that is exactly how a good model's mistake goes unnoticed.

### Small windows get a smaller fixed share

The system prompt and the tool definitions go out **in full on every request**. Compaction
(`/compact`) cannot shrink them. Once that share passes half the window there is no room
left however well you fold, and it looks like "the model suddenly got stupid".

Adding three tools (`Outline`, `Verify`, `Task`) pushed it to **49%** at 8k. Dropping a
tool would have fixed it — and would have made small models capable of different things,
which is the thing to avoid. The descriptions were trimmed to the window instead.

| | 8k | 16k | 32k+ |
|---|---|---|---|
| Base rules | short form | short form | full |
| Mode description | short form | short form | full |
| Tool descriptions | 90 chars | 140 chars | 220 / full |
| Obvious param descriptions | dropped | kept | kept |
| Descriptions inside array items | dropped | dropped | kept |
| **Fixed share** | **2,712 tokens (33%)** | 3,290 (21%) | 4,745 (4% at 131k) |

The **folder brief** adds roughly 80 more tokens at 8k (below). That value varies by
folder, so it is not in the table.

**Tool names and arguments are untouched.** What is possible is identical in every window;
what disappears is only the argument for *why* to use a tool. Large windows keep it,
because that argument earns its keep — those two sentences are what make a model call
`Outline` before `Read`.

A test pins these numbers (`test/compact.test.js`).

### On startup it reads what kind of project this folder is

Started in a folder of someone else's code, the model began knowing nothing. So it
retraced the same three steps every time — scan the top level, read `package.json`, find
out how tests are run. **On a local model each step is 20-40 seconds, so two minutes go
by before the work even starts.**

The worse case is the model *skipping* those three steps. Then it creates files by its
own conventions without knowing what the project already uses — a `requirements.txt`
dropped into an npm project.

The answers are all knowable at startup, so they are read once and put in the prompt.

The brief itself is written in Korean, like everything else deel puts on screen — this is
deel's own folder, wrapped here for width:

```
--- 이 폴더 ---                         (this folder)
node 프로젝트 (deel-local-cli) · git main
돌릴 수 있는 것: npm start · npm test · npm run bench · npm run chat · npm run check ·
                 npm run coverage · npm run demo · npm run diagnose      (runnable)
위쪽: bin/ src/ test/ LICENSE README.en.md README.md package.json report.txt   (top level)
위쪽 한 겹만 본 것이다. 안을 알아야 하면 Outline 을 불러라.
   (top level only — call Outline to see inside)
```

**Nothing is invented.** Runnable commands are copied verbatim from `scripts` in
`package.json`. Advertising a command that does not exist means the model calls it,
fails, and spends the steps you just saved looking for the real one.

**The last line matters.** What is listed is the top level and `package.json`, nothing
inside subfolders. Without saying so, the model treats this as a map of the whole project
and stops calling `Outline` — at which point the brief costs more than it saves.

| Not done | Why |
|---|---|
| No `git` subprocess | `.git/HEAD` is read directly. Spawning one freezes startup for seconds on a large repo |
| No directory walk | Top level **only**. Descending is slow on large repos, and only one line goes in the prompt anyway |
| Not re-read each turn | Once, at startup. A prompt that changes mid-conversation makes it impossible to tell why an answer changed |

It scales with the window — 10 entries and 4 commands at 8k, 24 and 8 on a large one.
If only one thing survives a narrow window it is the **commands**. The top-level listing
can be recovered with one `Glob`; "tests run with `npm test`" requires opening
`package.json`.

7ms on a folder with 600 files (`test/project.test.js`).

</details>

---

## Slash commands

Names follow Claude Code / Codex conventions.

| Command | What it does |
|---|---|
| `/help` | Command list |
| `/context` | What is consuming the context window |
| `/ctx [auto\|number]` | Context **length** — re-read it off the model, or set it yourself |
| `/grade [small\|medium\|large\|auto]` | Model **grade** — how much it does on its own. A different axis from `/ctx` |
| `/out [number\|auto]` | Cap on a **single reply** — raise it when large files get cut |
| `/compact` | Summarise and fold older turns |
| `/clear` | Clear the conversation (keeps link and rules) |
| `/model` | Switch connection / model |
| `/think <level>` | Reasoning level (`off·low·medium·high·max`) |
| `/think 배분 <profile>` | Per-stage profile (`even·save·deep`) |
| `/think 자세히` | Stage table — which stage runs at which level and cap |
| `/mode <mode>` | Approval policy — how much it asks (`auto` · `confirm` · `strict`) |
| `/work [mode]` | Work mode — what kind of work you are doing |
| `/auto` | Hand the wheel back — it picks the mode from what you type |
| `/code` `/plan` `/architect` `/debug` `/ask` `/orchestrator` | Switch work mode directly (pins it) |
| `/level [level]` | How much to show (`쉬움` simple · `개발자` developer) |
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
| `Ctrl+O` | Work mode (`종합` → `코드` → `계획` → …) |
| `↑` `↓` | Input history |
| `Ctrl+C` | Stops the answer in progress; twice on an empty line quits |

Korean IME composition, paste, `Ctrl+A/E` and backspace all keep working.

<details>
<summary><b>More</b> — Attaching a file with @ · Interrupting</summary>

### Attaching a file with `@`

Write `@` followed by a path and that file is sent along with your message.

```
❯ @src/a.js why is this slow?
  ◧ attached src/a.js
```

That removes **one round-trip** — the one where the model has to call `Read` itself. Local
models are weak at tool calling and that round-trip often misfires: it calls the wrong path,
or skips the call and invents the contents. You already know which file it is; there is no
reason to make the model go looking.

The hard part is not attaching. It is **not mistaking something else for a file.**
Things starting with `@` are everywhere.

| What you type | What happens |
|---|---|
| `@src/a.js` | Attached — only when the path actually exists |
| `hong@example.com` | Not a mention at all. A letter before the `@` means it is an address |
| `@media` · `@dataclass` · `@scope/pkg` | Left alone — no such path exists |
| `@src/` (a directory) | A listing of what is inside is attached |
| `@"draft report.txt"` | Quote names containing spaces |
| Outside the working scope | Refused, and the refusal is printed |
| A CP949 corporate document | Decoded by content and attached correctly |

There is one rule: **attach only when the path really exists.** Otherwise the text is left
exactly as typed, silently — it probably wasn't a mention.

Attachments are capped at **25% of the context length** (20,000 tokens at most). Anything larger is attached from the
top only, and a truncated file is **not marked as already read.** Marking it read would let the
model edit a part it never saw. Only a fully attached file lets it skip `Read`.

Every attachment is announced on screen. Text the user did not type is now in the conversation;
not showing it would also leave them wondering where the context went.

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

</details>

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

<details>
<summary><b>More</b> — Switching by itself (Auto mode)</summary>

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

</details>

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

<details>
<summary><b>More</b> — The input box · You don't have to type the whole command · The box stays while it works · The picture on the left moves too and 1 more</summary>

### The input box

Launched in a terminal, **the conversation scrolls normally and an input box is pinned at
the bottom.** Only the box is erased and redrawn — nothing above it is touched.

```
  ❊ Grep(console.log)
    └ 3 files · 11 hits
  ◈ Edit(src/runner.js)
    └ 1 spot +3-1
    - 12 console.log('시작', 이름)
    + 12 logger.info({ 단계: '시작', 이름 })

  ▌ Unified log calls to the logger format. One change in runner.js.

  ── 4.2s · 3 tools · ↑3,900 ↓180

 ▏myproject · qwen2.5-coder:7b ▏ ▰▰▱▱▱▱▱▱ 22% ▏ ◎ 종합 · ◇ medium · ⏵⏵ 자동
 ╭─────────────────────────────────────────────────────────────────────────────╮
 │ ❯ also shrink the aggregate helpers                                         │
 ╰─────────────────────────────────────────────────────────────────────────────╯
```

Terminal scrollback, selection and `Ctrl+F` all keep working, because the conversation is
never trapped inside a pane of ours. Long input grows the box to as many lines as it needs.

**It switches itself off where it would do harm.** Piped or redirected output, `CI` set,
`TERM=dumb`, or a window under 40 columns: no box, no asking. `deel … | tee log.txt` must
not become a pile of escape codes. Passing `--tui` does not override a pipe, and `--no-tui`
turns it off at any time.

Line editing stays entirely with Node's readline — Korean IME composition, paste, history,
Ctrl+A/E, backspace. We only *draw* the string readline is holding. Hand-rolling a line
editor is how you break IME input first.

> **A path taken and abandoned** — the first version borrowed the whole terminal (an
> alternate screen, like vim) and split it into conversation, changed-files and todo panes.
> It looked the part, and **every slash command went dead.** Six modules including
> `commands.js` write straight to the terminal rather than through the screen object, and a
> full repaint erased their output the instant it appeared. Not "the command didn't run" —
> "you can't see that it ran", which is worse. Fixing it would mean threading every one of
> those six through the screen object, plus every one added later, with a silent return of
> the same symptom if one is missed. So the design went the other way: let the conversation
> flow, manage only the box. ([`test/box.test.js`](test/box.test.js) spawns a child that
> pretends to be a terminal, so this one cannot ship again.)

---

### You don't have to type the whole command

There are over thirty commands. The only person who has them memorised is the one who
wrote them, and even he gets as far as `/mem…` and stops to wonder whether it was `memory`
or `memo`. If the only recourse at that point is typing `/help` and scanning thirty lines,
that isn't a command, it's a quiz.

So they show up **while you type.**

```
 ╭─────────────────────────────────────────────────────────────────────────────╮
 │ ❯ /mo                                                                       │
 ╰─────────────────────────────────────────────────────────────────────────────╯
   › /model [이름|list|models]   연결·모델 바꾸기 (이름 일부 · list · models)
     /mode <모드>                승인 정책 — 얼마나 물어보나
     /memory [지우기 <번호>|…]   대화가 끝나도 남는 기억 — 보기·지우기
```

`Tab` fills it in: all the way if only one matches, otherwise **only as far as they all
agree** (`/mo` + Tab → `/mode`). It doesn't pick one for you, because deleting the wrong
guess costs more than typing the rest. Commands that take an argument get a trailing space
so you can keep going.

Prefix matches come first and **substring matches follow** — typos cluster in the first
character, so `/emo` still surfaces `/memory`. The moment you type a space (`/mode auto`)
the list folds away: the command is already decided.

The list sits **below** the box. Putting it inside would push what you are typing upward,
so you could no longer see it.

> No up/down selection. That would have to take over **input history** (up arrow), which
> is used far more often. What is needed here isn't picking, it's recognising — and once
> you recognise it, one `Tab` is enough.
>
> Commands hidden at the `쉬움` level still surface when you type their prefix. Hidden is
> not the same as unavailable — someone who knows `/recall` should not be told it doesn't
> exist because of a display setting.

---

### The box stays while it works

Local models are slow. A single step can take tens of seconds, and if the bottom of the
screen goes blank for that long, **people assume it hung and hit Ctrl+C** — losing work that
was nearly done. So the border stays and only the contents change.

```
  ◧ Read(집계.py)
    └ 6 lines

 ▏myproject · qwen2.5-coder:7b ▏ ▰▱▱▱▱▱▱▱▱▱ 2% ▏ ◎ 종합 · ◇ medium · ⏵⏵ 자동 ▏ ↑3.8k ↓180
 ╭─────────────────────────────────────────────────────────────────────────────╮
 │ ⠹ 파일 들여다보는 중…                    12초 · 생각 1,240자 · Ctrl+C 중단 │
 ╰─────────────────────────────────────────────────────────────────────────────╯
```

The phrase tracks **what is actually happening**. This is not decoration: a message that
cycles at random stops being read after the second time, and from then on it is worth no
more than a blank screen. One turn reads like this:

```
머리 굴리는 중        →  파일 들여다보는 중  →  코드 짜는 중   →  답 쓰는 중
(turning it over)       (looking at files)     (writing code)    (writing the answer)
```

The phrases are Korean, because the interface is. Here is what each set means:

| Activity | On screen | Roughly |
|---|---|---|
| Thinking | 머리 굴리는 중 · 어떻게 할지 궁리하는 중 · 수 읽는 중 · 따져 보는 중 | turning it over · working out how · reading ahead · weighing it up |
| `Read` `Grep` `Glob` | 파일 들여다보는 중 · 코드 훑는 중 · 어디 있나 뒤지는 중 · 단서 찾는 중 | looking at files · skimming code · hunting for where it is · looking for a clue |
| `Write` `Edit` `Append` | 코드 짜는 중 · 고쳐 넣는 중 · 손보는 중 · 한 줄씩 옮기는 중 | writing code · patching it in · touching it up · moving it a line at a time |
| `Bash` | 명령 돌리는 중 · 터미널 두드리는 중 · 결과 기다리는 중 | running a command · at the terminal · waiting on output |
| `WebFetch` | 문서 찾아보는 중 · 읽어 오는 중 | looking up docs · fetching |
| Answering | 답 쓰는 중 · 정리해서 말하는 중 | writing the answer · putting it together |
| **Past 45 seconds** | 아직 하는 중 · 조금만 더 · 생각보다 오래 걸리는 중 | still going · nearly there · taking longer than expected |

Within a category the phrase advances every 4 seconds — text frozen for 30 seconds reads as
hung too. On the right: **elapsed time**, and while the model is reasoning, **how many
characters of thinking have arrived**. One number that genuinely increases is what turns
"still alive" from a claim into a fact.

### The picture on the left moves too

What spins next to the phrase is not a spinner — it is **a small drawing of the work being
done right now**.

| Doing | One cycle | The picture |
|---|---|---|
| Thinking | `⠀⠶⠀` `⠰⣿⠆` `⢾⣿⡷` `⠰⣿⠆` | swells and shrinks |
| Reading | `⠉⠉⠉` `⠒⠒⠒` `⠤⠤⠤` `⣀⣀⣀` | a scanning line travels down |
| Writing | `⡼⠭⠧` `⠼⡯⠧` `⠼⠿⡧` `⠼⡭⠧` | **a laptop typing** |
| Commands | `⠉⠀⠀` `⠉⠈⠀` `⠛⠊⠀` `⠿⠮⠄` | output piles up a line at a time |
| Answering | `⠉⠀⠀` `⠛⠉⠀` `⠿⠛⠉` `⣿⠿⠛` | text fills up |
| Web | `⣀⣀⣀` `⣤⣀⣀` `⣶⣤⣀` `⣿⣶⣤` | signal bars grow |
| Compacting | `⣿⣿⣿` `⣶⣶⣶` `⣤⣤⣤` `⣀⣀⣀` | pressed down into one line |
| Past 45 seconds | `⠶⠀⠀` `⠰⠆⠀` `⠀⠶⠀` `⠀⠰⠆` | back and forth — "waiting" |

Braille only. One braille cell is **2 wide by 4 dots tall**, so three cells make a 6×4 grid
that is exactly three columns in any terminal. Emoji and `●` `▪` include glyphs that East
Asian locales measure as two columns, which knocks the border out of line every 90ms.

If the drawing does not render, or you use a screen reader, `DEEL_NO_MOTION=1` turns it off
and you get the old single-cell spinner.

### What gets asked, and what just happens

Whether your files change **with or without being asked** is the one thing that has to be
readable at a glance. It sits on the right of the status line at all times.

| Indicator | Command | What it asks about |
|---|---|---|
| `⏵⏵ 자동 승인` (auto) | `/mode auto` | Nothing is asked. `/undo` is the safety net |
| `⏵ 위험만 확인` (risky only) | `/mode confirm` | Only irreversible commands. Files change unasked |
| `⏸ 모두 확인` (everything) | `/mode strict` | Every file change and every command is confirmed first |

`/mode` on its own lists all three and marks the current one with ●. The startup header
spells it out in a sentence, so the glyph is enough from then on.

**`Shift+Tab` cycles it without typing.** Each press moves one step and leaves a line
saying where it went. Whatever you were typing stays put.

```
  ⏵ 위험만 확인  되돌릴 수 없는 명령만 물어봅니다. 파일은 안 묻고 고칩니다
  자동 승인 → 위험만 확인 · Shift+Tab 으로 계속 바꿉니다
```

The cycle runs **loose → strict** (auto → risky only → everything → auto). A mistaken
press only makes it ask more; it never drops you into "changes files unasked" in one hit.

> That key used to cycle the work mode (`종합`, `코드`, …). The swap is about **who
> reaches for it more often.** Work mode follows your request on its own, while approval
> policy is what you want to change mid-task when a particular job deserves a look.
> Work mode moved to `Ctrl+O`; `/work` still does the same thing.

> It used to be the bare word `auto`. Next to `종합` and `medium·절약` it looked like just
> another mode, and nothing on screen said that one of them meant **files change without
> asking.**
>
> That also changed what gets truncated when space runs out. A corporate gateway model name
> like `databricks-gpt-5-6-luna` eats twenty-three columns, and that alone was pushing the
> approval indicator off the line entirely. Now **the model name shortens first** — you
> already know what you are running; whether your files change unasked is what you need now.

</details>

---

## Tools

Names and arguments match Claude Code, so skills written for that convention work unchanged.

| Tool | What it does |
|---|---|
| `Read` | Read a file (line numbers, `offset`/`limit`, **Excel as CSV**) |
| `Write` | Write / overwrite a file (**several at once via the `files` array**) |
| `Append` | Append to the end of a file — **how large files get written in pieces** |
| `Edit` | Replace an exact string (`replace_all`; **several sites at once via the `edits` array**) |
| `Glob` | Find files by name pattern |
| `Grep` | Regex search file contents |
| `Bash` | Run a command (**`background: true` for anything that does not finish**) |
| `Skill` | Expand a skill body (shown to the model only when skills exist) |
| `WebFetch` | Read a web page (read-only; hidden under `--offline`) |
| `Recall` | Search **past conversations** — the model digs up "that thing last time" itself |
| `Remember` | One line that outlives the session — known from the start next time |
| `TodoWrite` | Checklist — breaks long work into steps and shows progress |
| `Outline` | See a folder's **skeleton only** — tens of times cheaper than reading it whole |
| `Verify` | Check that what was built **actually works** |
| `Task` | Run one chunk of a big job in a **separate context** |
| `Jobs` | Inspect, read and stop **background commands** — the other half of `Bash`'s `background` |

Seven tools here are not in Claude Code — `Append`, `Recall`, `Remember`, `Outline`,
`Verify`, `Task`, `Jobs`. Each tool costs 150-400 tokens of schema on **every request**,
so a test stops you every time the list grows (`test/loop.test.js`). The last four earned
their cost; here is why.

<details>
<summary><b>More</b> — Outline · Verify · Task · Commands that never finish and 9 more</summary>

### Seeing a project's shape cheaply — `Outline`

There used to be only two ways to understand someone else's code. `Glob` gives you paths;
`Read` pulls a whole file into the window. **The middle was missing.**

So the model started editing without knowing what lived where, and re-created functions
that already existed somewhere else. It had not seen them — which is different from not
knowing.

```
❉ Outline(src/ui)   12 files · 122 places

src/ui/screen.js  (304 lines)
     46  fn     상자쓸까
     65  class  LineScreen
     92  method 줄
    198  class  BoxScreen
```

Reading that folder whole costs **25,612 tokens**; `Outline` costs **857** — 30x cheaper.
An 8k model can see the shape of a whole project.

It reads js/ts, py, java/kotlin, go, rust, c#, md, html, css, sh and json. Regex, not a
parser (zero dependencies). So it **says what it could not read** — dropping those
silently makes the model believe the file does not exist, and rebuild config that is
already there.

### Checking what was built — `Verify`

The end of a turn used to say:

```
  ✓ index.html · 410 lines · 18.2KB
```

That proves the file **exists**, not that it **works**. An unclosed `<div>`, a
`src="app.js"` pointing at nothing, a JS file one bracket short — all green.

What can be run gets run (`node --check`, `py_compile`); what cannot gets read (HTML tag
pairing, missing references, CSS braces, JSON).

```
⏺ Verify   1 broken · 3 checked
```

And the part that matters most — **what could not be checked is reported as such.**

Arbitrary commands are **not** run here. That path has to be `Bash` alone: the approval
gate and the safety checks live only there, so running commands from here would break the
strict-mode promise in exactly this one spot. It tells you `npm test` exists instead.

### Splitting big work off — `Task`

Building eight files in one window means all eight files pile up in that window. On a 32k
model it fills around the third or fourth, and once it fills, earlier turns get folded
away. From then on the model has forgotten what it was building — **no error appears, the
result just gets worse.** That was the root of "build me a dashboard" ending as a plan.

`Task` runs that chunk in a **fresh conversation** and returns only a summary.

```
⌥ subtask  build the page skeleton   separate conversation · max 8 steps
 │  ◆ Write(index.html +1)  2 files · 24 lines
✓ subtask  build the page skeleton   done · 2 files · 2 steps
```

Peak conversation size while building the same four files (system prompt excluded):

| | Peak |
|---|---|
| All in one window | 4,181 chars |
| Split with `Task` | **2,113 chars** |

The left column keeps growing with each file; the right one does not.

**Every guard still applies.** A subtask runs inside the same working folder, follows the
same approval mode, is undone **together with** its parent by one `/undo`, and lands in
the audit log. There is no path for a subtask to edit files under a read-only mode
(architect, plan, ask) — that is blocked both at the mode level and in the tool list.
Nesting stops at two levels.

### Commands that never finish — `Bash`'s `background` and `Jobs`

`Bash` only returns once the command **ends**. So anything that does not end could not be
run — `npm run dev`, `python -m http.server`, `vite`, `npm run watch`. Asking for one used
to mean waiting 120 seconds and then a kill, leaving one line on screen.

```
  ▶ Bash(npm run dev)
    └ 시간 초과로 중단됨 (120000ms)                              2분 0.0초
       (timed out)
```

The model concludes the server would not start and gives up, or worse, raises `timeout`
and calls again — which stalls the whole turn. **There was no way at all to start what
you built and check it.** `Verify` gets you as far as "the syntax is valid"; whether it
actually comes up requires bringing it up.

```
  ▶ Bash(npm run dev)
    └ 1번으로 띄움          (started as job 1)

  ◈ Edit(src/App.jsx)
    └ 1군데                 (1 site)

  ◐ Jobs(1번)
    └ 도는중 · 24초         (running · 24s)

  ◐ Jobs(1번 · 끝내기)
    └ 끝냄 · 41초           (stopped · 41s)
```

It starts and **returns immediately**. Output accumulates and `Jobs` reads it.

**Something that did not start is never reported as started.** The job is watched briefly
after launch, and if it dies in that window it comes back as a failure. The most common
failure is a port already in use; reporting that as "started" sends the model on to the
next step while you refresh a server that was never there.

```
  ▶ Bash(npm run dev)
    └ 띄우자마자 끝났습니다 (종료코드 1).
       (exited immediately, exit code 1)
```

| Guarantee | Detail |
|---|---|
| Safety checks | **Identical** to `Bash`. This must not become a back door |
| Cleanup | Everything is killed when deel exits — **down to grandchildren**, and it says how many |
| Retained | 256KB. Past that the front is dropped and **the drop is stated** |
| Handed to the model | 4,000 chars. This **must** be a different number from the one above |
| On stop | Waits for the dying output, and returns only once the process is **actually dead** |
| Argument names | Korean and English both accepted (`번호`/`job`, `끝내기`/`stop`). Unrecognized ones **are reported** |
| Count | Eight running. Finished jobs keep the most recent eight, and evictions **are stated** |

Why two different caps: make them equal and every overflow of a `watch` job means
one `Jobs` read dumps 256KB into the window. On an 8k model that single read ends
the window.

**Stopping a job does not close its pipes immediately.** At the moment the kill is
issued there is still unread data in the pipe, and the last few lines before a
death are the ones that matter — the stack trace a server leaves on the way down.
Printing `last output:` and then withholding the last output is worse than not
printing it. It also waits until the process is **confirmed dead** before dropping
it from the list: dropping a live one means it can never be named again, which is
the exact state this feature exists to prevent.

Finished jobs are not dropped right away — they are kept so their final output can
be read. Only the most recent eight survive; otherwise thirty short commands leave
thirty entries, each holding up to 256KB.

**Argument names are accepted in both Korean and English.** Models frequently
translate Korean parameter names into English — not a guess, something this repo
already hit (`Task` accepts both `목적` and `purpose`). `Jobs` did not, which meant:

```
Jobs({job: 1, stop: true})   ->   a listing comes back. The server keeps running.
```

The model asked for a stop and **got what looks like a success** while the port
stays held. So both spellings are accepted, and when nothing is recognized it says
so rather than falling back to a listing. The name mapping lives in exactly **one**
place — the on-screen label reads it too. Two copies means the tool works while the
label shows empty parentheses.

**Killing grandchildren is where this quietly goes wrong.** `npm run dev` descends
npm → node → vite, and the thing holding the port is at the bottom. Windows has
`taskkill /t` to walk the tree; Unix has nothing equivalent, so the job is
**started in its own process group** — after the fact there is no way to name a
grandchild at all. Skip that and deel says "killed 3" while the server keeps running.

Cleanup is where this quietly goes wrong. Skip it and a process nobody started keeps
running. Next time you start a dev server you get "port already in use" with **no way to
find what is holding it**. So `test/jobs.test.js` verifies the process actually died, via
a file the child keeps appending to.

`deel run` (one-shot mode) does the same. A batch job is hurt worst by missing this — the
job reports done, the server keeps running, and the next job fails to bind the same port
with nothing in the log to explain it.

### Several at once — `Write`'s `files`, `Edit`'s `edits`

One round trip is 20-40 seconds on a local model. Creating five files with five `Write`
calls is two to three minutes of nothing but round trips. So they go in one array.

```
  ◈ Edit(src/app.js 외 2군데)
    └ 2개 파일 · 3군데      (2 files · 3 sites)
      ✓ src/app.js · 2군데
      ✓ src/style.css · 1군데
```

**Editing is worth more than writing here.** Creating files happens once; editing happens
continuously. Six edit sites at six round trips is minutes gone.

| | Guaranteed |
|---|---|
| Applied in order | Editing one file twice is common. Each edit re-reads from disk, so later ones see earlier results |
| One failure | The rest still run. Stopping at the first failure re-adds the round trips this was meant to remove |
| On failure | "Resend only what failed — **and `Read` the file again first**" |
| Undo | Still **one turn**. Six sites in one file is one `/undo` |
| Single-site form | The result shape is byte-for-byte unchanged |

It reports `2 files · 3 sites` rather than a single number. Editing one file at six sites
is normal, so "3 files" would be false — and once the screen stops matching what you can
count yourself, you stop trusting the screen.

### Finding past conversations, and remembering decisions

deel writes every conversation to `.deel/sessions/*.jsonl`. Until now all you could do was
list them — **a record you cannot search is the same as no record.**

```
$ /recall 인코딩을 어떻게

  2026-08-01 10:15  모델    20260801-101500
      CP949 인코딩 문제입니다. 읽을 때 인코딩을 재서 그대로 되돌려 쓰도록…
```

Korean particles are handled: `인코딩을` also matches `인코딩`. A morphological analyser is
out of the question (zero dependencies), so particle-looking tails are stripped and **both**
forms are searched. No index is built — an index inevitably goes stale, and **a stale index is
worse than none** ("not found" reads as "never happened"). Instead every search reports how
much it read and what it could not.

`Recall` is also a **tool**. Left as a human-only command, "do it the way we decided last
time" leaves the model nothing to do but ask again.

**Memory (`/memory`) is a different thing.** Recall has to be *searched*; memory is *already
there*. Things you cannot re-explain every session go here.

```
$ /memory

   1  사내 문서는 CP949 로 읽고 CP949 로 되돌려 쓴다
   2  검증할 때 7080 포트는 쓰지 않는다

  2줄 · 약 30토큰이 매 요청마다 함께 나갑니다
  파일 .deel/memory.md — 직접 고치셔도 됩니다
```

`.deel/memory.md` is **prose a human edits**, not a database. That matters: a line the model
got wrong ships on every request and keeps being wrong. **A wrong memory is worse than none.**
So `/memory 지우기 2` deletes one.

Because it ships on every request it is bounded: 400 chars per line, 60 lines, 6,000 chars
total. Overflow drops the oldest and says so. `/context` shows its line count and tokens.

### Repeatable procedures become skills

When a multi-step job finishes and it is something that will come up again, the model writes
the procedure to `.deel/skills/<name>/SKILL.md`. Next session it appears in the skill list;
when it turns out to be wrong somewhere, the model edits that file.

No new tool needed — the existing `Write` writes it and the existing skill sweep reads it.

### Large files are written in pieces — `Append`

A model with a 4k output cap still has to be able to write a 2,000-line file, eight pieces at
a time. Stitching with `Edit` does not work in practice — HTML repeats anchors like `</div>`,
so the match comes back as "found in several places", and a longer anchor eats the tokens that
should have gone into the body.

`Write` to create, `Append` to continue. Encoding follows `Write` (CP949 for corporate
documents, the BOM on a `.csv` is preserved). The undo snapshot is taken **only on the first
`Append`** — eight appends must not leave eight copies in the history, or there is no single
point to revert to.

```
  ⏺ Write(dashboard.html)
    └ ⚠ wrote only as far as it arrived — 632 lines
  ↻ the reply hit the cap — retrying with 9,984 → 16,384
  ⏺ Append(dashboard.html)
    └ +567 lines · 1,199 total

  ✓ dashboard.html · 1,199 lines · 97.7KB
```

That last line matters. If the file does not exist and the model says "created it", you would
believe it. **The real file is measured at the end of the turn.**

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

### It shows you what it changed

`auto` mode edits without asking. That is the speed of this tool — but if all that reaches the
screen is `1 spot`, you move on without knowing what happened. Undo is the safety net, and
**you cannot decide whether to undo something you never saw.** So every `Edit` and `Write` is
followed by the changed lines themselves.

```
  ◈ Edit(src/runner.js)
    └ 1 spot +1 −2

      11 const id = job.id;
    -    console.log("start: " + id);
    -    console.log("  opts " + JSON.stringify(opts));
    + 12 logger.info('start', { id, opts });
      13 return run(job);
```

The `+1 −2` next to the summary is how many lines were added and removed.

- **Removed lines carry no line number.** They no longer exist in the file. Printing the old
  number put it directly under a context line's new number — two different files' numbering in
  one column. Line 8 really did appear twice on screen.
- If only the line endings changed (CRLF/LF), it says so. Otherwise every visually identical
  line shows as changed and the real edit is impossible to find.
- Large files are compared after trimming the identical head and tail. If it is still too big,
  exact matching is abandoned for "this whole block changed" — a rough answer now beats an
  exact one later.

How many lines are shown depends on the level. Forty lines at someone's first launch means none get read.

| | Simple | Developer |
|---|---|---|
| After a tool call | 14 lines | 40 lines |
| `/diff <file>` | 60 lines | 200 lines |

### `/diff` — everything changed this session

Those lines scroll away. `/diff` collects every file touched this session onto one page.

```
$ /diff

── files changed this session ─────────────────────────────
  src/runner.js                     +12     −7   3×
  src/logger.js                     +40     −0
  ──────────────────────────────────────────────────────────
  2 files                            +52     −7

  /diff <file> for detail, /undo to revert
```

`/diff <file>` compares **the state at the start of the session against now.** Even after
three edits, what you want to know is "what is different from before I asked", not what the
last edit did. That original state comes from the earliest undo snapshot.

`/diff` is **in the simple level's command list.** As long as `auto` edits without asking,
a beginner needs a way to see what changed more than anyone.

</details>

---

## Korean text and Excel

**A file saved as CP949 is written back as CP949.** The encoding is never changed.
Excel (`.xlsx`) is read as CSV — read-only.

<details>
<summary><b>More</b> — Encoding · Excel</summary>

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

**Undo snapshots are stored as bytes too.** They used to be stored as UTF-8 text, so undoing
a CP949 file brought back `가나다` (bytes `b0a1 b3aa b4d9`) as six U+FFFD characters — **the
safety net itself destroyed the original bytes.** Now every snapshot is round-tripped through
UTF-8 first; anything that does not come back identical is stored as base64 and restored
byte-exact.

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

</details>

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

<details>
<summary><b>More</b> — Loaded in three stages · Fetching plugins · Deliberately not included</summary>

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

</details>

---

## Reasoning effort

One answer means several model calls, and **each needs a different amount of thinking.**
All-high is slow; all-low wanders off.

The default is **one line**. What you want to know is how hard it is thinking right now,
not a stage table.

```
$ /think

  추론 강도  medium   (첫 판단 medium · 이어가기 low · 막혔을 때 high)
  더 세게 /think high   더 빠르게 /think low
```

| Profile | Character |
|---|---|
| `even` | Same effort everywhere — predictable, slower |
| `save` (default) | Hard on the first decision only |
| `deep` | Everything one notch up — for hard work |

Set the profile with `/think 배분 절약`. **Level and profile are different axes, so the
commands were split** — `/think high` and `/think save` used to set different things under
one name, which made the screen unreadable.

The stage table moved to `/think 자세히` (the default at developer level).

```
$ /think 자세히

  추론 강도  medium   (첫 판단 medium · 이어가기 low · 막혔을 때 high)
  배분      절약   첫 판단만 세게, 이어가기는 얕게 — 대개 이게 낫습니다

  단계        강도      출력상한  언제
  첫 판단     · medium      15,549  무엇을 할지 정하는 자리
  이어가기    ↓ low         13,605  도구 결과를 읽고 다음 한 수
  막혔을 때   ↑ high        16,384  직전 도구가 오류를 냄

  출력 상한은 16,384 (모르는 값이라 기본값) 안에서 나눕니다 — /out
  컨텍스트 40,960 · 지금 찬 양 2,087
```

That second-to-last line exists for a reason: **when all three caps are equal, it is the
only thing that says whether that is correct.** A low known cap makes them equal, and that
is fine. For a while all three read `16,384` always — which meant the table said nothing.

<details>
<summary><b>More</b> — Context length is read off the model · /out · Truncated tool calls</summary>

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
| `/ctx 자세히` | Which endpoints were probed and what each returned — how to see why a lookup failed |
| `deel --ctx 655360` | Start at this value (skips the lookup) |

**`k` means 1024 here.** Context lengths are all powers of two, so that is the only base
that lines up: 655,360 is `640k`, not `655k`; 131,072 is `128k`, not `131k`. The display and
`/ctx` use the same unit, so typing back what you see gives you the same number.

### Reply length cap — `/out`

Context (how much can be held) and the **output cap** (how much can come back at once) are
different numbers. Treating them as one makes it impossible to understand why a large file
never gets written — the context is roomy while the reply is being cut.

| Command | What it does |
|---|---|
| `/out` | Current cap and **where it came from** (set by you / discovered / default) |
| `/out 32k` | Set it yourself (`k` is 1024). Saved to the profile |
| `/out auto` | Drop your value and go back to the discovered one, or the default |
| `deel --max-tokens 65536` | Start at this value |

The old name `/ctx out 32k` still works.

**Caps are not fixed numbers.** They are computed from the model's context window and how
much of it is currently used — the profile decides what share of the remaining room a stage gets.

| Model | First call | Continuing | Stuck | Retry after truncation |
|---|---|---|---|---|
| 2k local | 819 | 716 | 921 | 1,638 |
| 8k local | 3,276 | 2,867 | 3,686 | 6,553 |
| 40k (qwen3) | 16,384 | 14,336 | 16,384 | 16,384 |
| 128k gateway | 16,384 | 16,384 | 16,384 | 16,384 |
| 128k, 80% full | 10,485 | 9,174 | 11,796 | 16,384 |
| 640k with `/out 65536` | 65,536 | 65,536 | 65,536 | 65,536 |

Caps shrink as the context fills. Handing a 4k model a 4,096-token cap would leave no room for input.

The last row is the point: **a known cap overrides the 16,384 default.** For a while it did
not — the third argument of `Math.min(cap, max ?? 16384, 16384)` clamped it right back, so a
configured cap could only be lowered, never raised. Meanwhile the comment, the README, and the
on-screen help all said it could be raised. A documented escape hatch that is welded shut is
the worst kind.

If a cap truncates a reply, **the call is retried with the cap lifted** — and the thinking
level drops one notch, because reasoning tokens eat the same budget first. Without that, more
headroom just buys more thinking. A truncated reply means a half-written tool call, which fails silently.

**When the server refuses, it is read for the answer.**

```
This model's maximum context length is 8192 tokens, however you requested 41003
```

The number is extracted, applied, and the call is retried. You never see the failure.
No spec knowledge is needed, so **this works against servers we have never seen.**

### Truncated tool calls

This actually happened. A user asked for a dashboard; the model tried to put an entire HTML
document into `Write`'s arguments, hit the output token limit, and the arguments JSON arrived
cut off mid-string.

The old code quietly turned that unparseable JSON into `{_raw: "..."}` and handed it to the
tool. The tool answered `path is empty` — **a message with nothing to do with the real cause.**
The model had not omitted the path, so there was nothing to fix; it retried identically, and
was truncated again.

```
  ◆ Write(dashboard.html)
    └ path is empty          ← nine identical times

  ── 71s · 13 tool calls · context filled and auto-compacted · no file produced
```

One silently swallowed value produced all of that. What happens now:

| | Now |
|---|---|
| Unparseable arguments | **Marked as truncated**, not swallowed. Never passed to the tool |
| The model is told | Exactly what happened, and to stop resending the whole thing — write a short skeleton first, then **build it up with `Edit`** |
| The truncated payload | Never re-injected into the conversation — it is half a payload and it costs context |
| Detecting truncation | Even when the gateway reports `finish_reason: "stop"`, **broken arguments are themselves proof it was cut.** No model writes half a JSON object on purpose |
| Three identical failures | The turn stops, with a suggestion to split the request |

```
  ⊘ Stopped — it is spinning in the same place.
    the same tool call keeps getting truncated
    What you asked for in one go is larger than the model's output cap. Try splitting it —
    e.g. "just the skeleton first" → "now add the table" → "now add the chart"
```

**A step limit (`maxSteps`) cannot catch this.** It cannot tell a long healthy task from a
spinning one. What is counted here is not steps but **how many times the same tool failed for
the same reason.**

</details>

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

<details>
<summary><b>More</b> — But this is somebody else's program</summary>

### But this is somebody else's program

This project exists because unapproved software is blocked. Turning on MCP carelessly would
tear down that line with our own hands. So:

| | |
|---|---|
| **Off by default** | Nothing runs unless it is in `.deel/mcp.json` |
| **Never under `--offline`** | We cannot police where a child process connects. **We do not claim to block what we cannot block** |
| **Outside the working scope** | MCP servers do not honour our fence. The `/mcp` screen says so |
| **Audited** | What was launched and what was called, in `.deel/audit.jsonl` |
| **No key passthrough** | Our environment is not forwarded wholesale — a `DEEL_*` gateway key in someone else's process goes somewhere we cannot see |
| **Not in read-only modes** | A tool named "search" can still write files. Handing an unknown to plan/architect mode would make that promise meaningless |
| **24 tools per server** | Schemas ship on every request. Past that they are dropped, and **the drop is reported** |

One server crashing, hanging, or talking nonsense does not affect the others. Failures are not
swallowed — the reason appears in the header, because a silent drop leaves "why is that tool
missing?" unanswerable.

</details>

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

<details>
<summary><b>More</b> — Files removed through Bash come back too · What it will not read</summary>

### Files removed through `Bash` come back too

The safety net covered `Write` and `Edit` only. But a model moving a file reaches for
`Bash` — `mv old.js new.js`, `rm temp.txt`. The file was gone and `/undo` could do
nothing about it. It was half a safety net.

Now a mutating command snapshots the files it names beforehand, and **says what it saved,
right there**.

```
  ▶ Bash(mv src/old.js src/new.js)
    └ 성공
      ↩ src/old.js 는 떠 뒀습니다 — /undo 로 되돌아갑니다
         (saved src/old.js — /undo restores it)
```

`mv` and `rm` leave one "success" line on screen. From that line alone there is no way to
tell whether it is reversible, so people either assume it is and move on, or assume it is
not and get scared. So the fact is stated.

**What cannot be saved is not hidden.** Shell-expanded wildcards (`rm *.tmp`), deletions
inside a script, and whole directories are invisible here. In those cases the `↩` line
simply does not appear — **it never claims "everything is reversible"**. False reassurance
means people stop checking.

Snapshotting casts a **wider** net than blocking does. The scope guard (`checkPaths`) only
treats words containing a slash as paths — anything else would block legitimate commands —
but `del target.txt`, with no slash, is the most common form there is. This is a reading
site rather than a blocking one, so it scans broadly and saves a file only when one is
actually there. A wrong guess costs nothing. Up to 24 per command.

### What it will not read

Walking a folder turns up things that are not project files: the private stores other coding
tools keep — past conversations, command history, caches, and keys. They have nothing to do
with the task, but once they appear in a listing the model reads them first.

```
  ◧ Read(~/.deel/audit.jsonl)      77 lines
  ◧ Read(~/.claude/history.jsonl)  35 lines
```

The audit log is **this program's own record of what it just did.** Reading it back into the
conversation makes the model chase its own shadow. It has nothing to do with what was asked,
and it fills the context.

The config file is worse. `.deel/config.json` holds the gateway **API key.** Reading it puts
that key into the conversation, sends it to the model, and writes it into the on-disk session
log. It hands the key to the very service the key is for.

| Refused | Why |
|---|---|
| `.deel/config.json` | Contains the gateway key |
| `.deel/audit.jsonl` · `.deel/sessions` · `.deel/history` | deel's own records — chasing its own shadow |
| `.claude` `.codex` `.cursor` `.gemini` `.aider` `.continue` `.cline` `.roo` `.kilocode` `.windsurf` `.opencode` `.zed` `.trae` `.augment` `.qodo` `.tabnine` `.cody` `.sourcegraph` `.copilot` `.amazonq` `.junie` `.codeium` `.goose` `.crush` `.gptme` `.openhands` `.devin` | Other tools' private stores |
| File-style leftovers like `.aider.chat.history.md` | Same reason |

Writing is blocked too, not just reading. Blocking only reads would still let the agent
overwrite another tool's settings, and overwriting `.deel/config.json` destroys the connection.

**It blocks, it does not hide** — the refusal says exactly why. New tools keep appearing;
when a name is missing from the list, **adding it is one line.**

That list lives in **exactly one place in the source.** The directory walker (`SKIP_DIRS`) and
the read guard look at the same set. They used to be two copies, and two copies means the day
comes when only one of them learns a new name — a folder that is skipped while walking but
readable if you name it directly, which is very hard to explain.

</details>

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

<details>
<summary><b>More</b> — Diagnosing a corporate gateway</summary>

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

</details>

---

## Configuration

Stored in `~/.deel/config.json`. A `.deel/config.json` in the project folder takes precedence.

<details>
<summary><b>More</b> — Supported servers · Environment variables · Flags · Project rules</summary>

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
deel --ctx <length>      Set the context length yourself (655360 · 640k · 128k)
deel --max-tokens <len>  Cap on a single reply (32k) — same value as /out
deel --think <level>     off / low / medium (default) / high / max
deel --effort <profile>  even / save (default) / deep
deel --offline           Nothing leaves this machine
deel --continue          Resume the most recent conversation
deel --resume <id>       Resume a specific one
deel --no-tui            Turn the input box off; plain scrolling view (see below)
```

### Project rules

If the working folder has `DEEL.md`, `CLAUDE.md` or `AGENTS.md`, it is loaded as project rules.
`/init` scaffolds one.

</details>

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
| Empty replies | The server ignores streaming. deel retries once, then turns streaming off for the session |
| Large files cut off mid-write | Check `/out` and raise it — the cap may be sitting at the 16,384 default because it could not be discovered |
| Only `HTTP 400` shows | The server's own message is shown verbatim. If it is a length problem the number is read and applied automatically |
| `deel scan` finds nothing | Server is off or on another port — use `--ports` |

---

## Development

```bash
npm test          Full suite (1,832 checks)
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
| `abort` | 16 | Ctrl+C leaves the conversation valid |
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

<details>
<summary><b>More</b> — Coverage · Layout</summary>

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
  ui/approve.js          approval mode display (auto / risky only / everything)
  ui/diff.js             showing what changed, where it changed
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

  backend/http.js        the single HTTP layer (the only door out)
  backend/detect.js      protocol and auth detection
  backend/adapter.js     absorbing OpenAI/Ollama differences + streaming parser
  backend/ctxsize.js     reading context length off the model
  backend/probe.js       8 diagnostic checks
  backend/scan.js        scanning for local servers
  backend/mcp.js         attaching outside tools (MCP, stdio)

  tools/index.js         15 tools
  tools/edit-match.js    staged-relaxation edit matching
  tools/outline.js       a file's shape, cheaply
  tools/verify.js        checking what was built
  tools/task.js          splitting big work off
  tools/jobs.js          commands that run in the background
  tools/todo.js          checklists
  tools/webfetch.js      reading the web (read-only)
  tools/encoding.js      writing back in the encoding it was read in
  tools/xlsx.js          Excel → CSV (written here)

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

</details>

---

## Licence

[MIT](LICENSE)
