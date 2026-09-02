[← back to README](../../README.md)

# Models

Moving between models, grade and window size, Korean-model presets, project detection

---

## Multiple local runtimes

<sub>It adapts to whatever model is attached · Korean models are known before they are experienced · Small windows get a smaller fixed share · On startup it reads what kind of project this folder is</sub>

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

### Korean models are known before they are experienced

The experience-based card (`/model card`) needs 12 steps before it acts. But some habits
are known before any step is taken — **a reasoning model's thinking eats the output
budget, and answers get cut.** That is in the public docs; it does not need twelve steps
of re-confirmation. So this one thing applies from step one: attach a reasoning model
and the output cap starts generous.

Half of the built-in name tags (`src/agent/preset.js`) are Korean — **EXAONE ·
EXAONE Deep (LG) · HyperCLOVA X SEED (Naver) · Kanana (Kakao) · Midm (KT) ·
Solar (Upstage)** — plus Qwen3, the most common local name. These are the models that
actually run where this program runs (corporate GPUs), and foreign tools do not know
these names.

```
/model card

  ── model card ────────────────────────────────
  exaone-deep:7.8b  · steps walked together 0
  ◆ EXAONE Deep (LG) · known model
    LG's reasoning model. Thinks long on math and code — per its public docs.
```

There is a line it keeps. **Only what comes from public documentation is written in
advance** — pretending to have experienced what it has not would make the whole card a
lie. So the only pre-applied adjustment is the one thing the docs can confirm (reasoning
or not); every other habit (truncation, repeats, missed edits) is still caught only by
experience. What was experienced beats this table. Unknown models change nothing.

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

---

[← back to README](../../README.md)
