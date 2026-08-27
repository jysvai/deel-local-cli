[← back to README](../../README.en.md)

# Release notes

What changed in each version, and why

---

## 1.4.1

**No new features — only things actually found and fixed**

Before posting to Reddit, a self-review of the GitHub Security tab turned up a
few real issues. Below is what got fixed. No new capability shipped.

#### 1. `/preview` could vanish on Windows with zero error output

The recursive folder watcher (`fs.watch(recursive: true)`) hits a libuv
assertion — and a hard process abort — when the watched path uses a short
(8.3-style, e.g. `RUNNER~1`) name or crosses a junction. That's a native abort,
uncatchable by try/catch, so the session just disappeared with nothing on
screen. Fixed by resolving the path to its canonical long form before
watching.

#### 2. The regex that blocks dangerous commands could itself hang

The safety guard's pattern for catching `Remove-Item -Recurse ...`-style
commands had a ReDoS (catastrophic backtracking) shape. A crafted 74-character
input made the check itself take over 15 seconds — ironic, given it's the
safety net's own regex. Detection behavior is unchanged; only the pattern
shape was fixed.

#### 3. Stored XSS in the `/preview` directory listing

The file-listing page shown for a folder with no `index.html` inserted file
names into HTML without escaping. A file whose name contained `<script>`
would execute when the folder was opened. The visible text is now escaped
too.

#### 4. `WebFetch` double-unescaped HTML entities when converting a page to text

Decoding entities one pass at a time (unescape `&amp;` first, then look for
`&lt;`) meant a doubly-escaped `&amp;lt;` got decoded twice into a literal
`<`. Fixed to decode in a single pass.

#### 5. README and docs redrawn

The 2,800-line README became an 870-line summary plus ten per-language doc
pages. Badges, the hero image, and the table of contents were redrawn too —
that's a how-it-looks story, not a what-changed one, so it's kept brief here.

## 1.4.0

**deel gets a face, speaks English, and sees meaning**

<br>

| | Before | After |
|---|---|---|
| `/undo` | rolled back files only — the conversation still believed it happened | rewinds **the conversation too** |
| Turns that take minutes | you sat watching the screen | a bell and the window title — you can be in another window |
| Startup · status bar | looked like any other CLI | letters that grow on start, a status bar that names the boundary |
| English speakers | the screen was all unreadable | `/lang en` — the screen **and what the model reads** |
| Models per session | one | a different model per chunk — routine work to a small one |
| Finding a name | `Grep` only — comments and strings mixed in | `Def` / `Refs` — by **meaning**, when a server is installed |
| A file you just edited | you found out by running it | checked **right after** the edit, that file only |
| HWP · Word · PPT | "binary — cannot read" | `.hwpx` / `.docx` / `.pptx` read **as text** |
| Long conversations | a mode switch recomputed the whole conversation | the prefix cache **survives** — what changes goes last |
| A record of the work | terminal scrollback | `/export` — a one-page report, **unproven items included** |
| Korean models | 12 steps of experience before it knew anything | EXAONE · HyperCLOVA X · Kanana · Midm · Solar known **in advance** |

<br>

#### 1. `/undo` rewinds the conversation

Roll back only the files and the conversation still holds the edit. The model believes it
just changed that file and builds the next step on top — and nothing on screen says
otherwise. Now the messages fold back with the files. Folding can orphan a tool call, which
the server answers with a 400, so the same `repairToolPairs` runs over the result.

#### 2. It tells you when it is done — `/bell`

A local model can take minutes per turn. A bell and the window title say when it finishes.
The bell is ``, but **not one byte reaches a pipe** — with no TTY it writes nowhere. The
title ends with ST, not BEL; ending with BEL rings the bell on every title update.

#### 3. A screen that is deel's own

The name comes up large on start.

```
            ████                                        ████
            ████                                        ████
  ██████████████    ████████████    ████████████        ████
████        ████  ████        ████  ████        ████    ████
████        ████  ████████████████  ████████████████    ████
████        ████  ████              ████                ████
  ██████████████    ████████████      ████████████        ████████
╰──────────────────────────────────────────────────────────────╯  ⌂ stays on this machine
```

**No rainbow.** Modern CLIs open with big letters flowing from blue to pink. It looks good,
but that colour says nothing. deel says exactly one thing — **your source does not leave this
machine** — so that space carries the meaning instead.

- A **line closes** under the name. That line is the boundary.
- Its **colour says how far your source travels**: green `⌂` this machine, yellow `↗` an
  in-house gateway. It is the **same glyph** the status bar uses, so what you saw on start
  stays on the line below.
- The letters brighten left to right — the same direction they arrive in, so it reads as
  **growing** rather than as a pattern.

The order carries meaning too. The name arrives → a beat of pause → the line closes → **only
then** does the caption appear. A claim is worth something once the boundary is shut. The
whole thing takes 0.4s; the person who opens this ten times a day is the one it is timed for.

It does not force the big form into a narrow window. At `68 columns` you get the large name,
at `36` a single-width one, and below that the old `deel` → `deel-local` motion. Letters that
wrap are unreadable, and that is worse than drawing nothing — it reads as a broken screen.

**Pipes, CI and logs get one small frame.** An eight-line drawing at the head of a log file is
just noise to whoever reads it.

The fill is `█` and the rule is `╰─╯`, nothing else. Emoji and geometric shapes are East Asian
Ambiguous, so their width varies per terminal and the line drifts by a column.

#### 4·5. English on screen, and in what the model reads

`/lang en` switches the screen. Untranslated strings come through in Korean rather than as
blanks, and `/lang` counts honestly how many are left.

But switching only the screen leaves the model answering in Korean — its rules say to. So
what the model reads switches too (base rules, mode instructions, all sixteen tool
descriptions). There is a bonus: Korean costs about one token per character and English
about one per 3.6, so the fixed share of a 32k window dropped from **4,910 to 3,446 tokens.**

Tool names and argument names are **not** translated. Those are identifiers.

#### 6. Several models in one session — `Task`'s `모델`

A large model and a small one, together, on 8GB of RAM. Routine work (formatting, repetitive
edits, short summaries) goes to the small one; you keep what needs judgement. The subtask's
endpoint opens through `allowTemporarily` and **always closes in `finally`** — afterwards
exactly one endpoint is open again.

#### 7. Language servers — `Def`, `Refs`, post-edit diagnostics

See "With a language server, it sees meaning" in [Tools in depth](tools.md). **It installs nothing.**

#### 8. HWP, Word and PowerPoint as text — `Read` opens `.hwpx` / `.docx` / `.pptx`

See [Korean documents and Excel](documents.md). Handing over a document and saying
"build this to spec" finally works. Editing is deliberately not supported — round-tripping
a formatted document through plain text always loses something.

#### 9. Why long conversations kept getting slower — the prefix cache

See "The hidden latency of local models" in [Speed and spend](tuning.md). Anything that can change every turn
(mode, pins) moves to the end of the prompt, and Ollama gets `keep_alive: 60m`. This
latency never showed up anywhere because it was not an error.

#### 10. The conversation becomes a one-page report — `/export`

An air-gapped network has no session-sharing links — links need a server. So it is a
file instead: what was asked, what changed, what verified it, and **what remains
unproven.** A self-contained HTML with zero external URLs, so it opens anywhere.

#### 11. Korean models are known before they are experienced — `agent/preset.js`

See "Korean models are known before they are experienced" in [Models](models.md). Only the one thing the
public docs can confirm (reasoning or not) is applied in advance; everything else is
still learned by experience.

## 1.3.0

**evidence instead of claims, the editor instead of a terminal**

<br>

| | Before | After |
|---|---|---|
| Rules that must hold | **vanished** when folded or summarised | live outside the message list, where folding cannot reach |
| This model's habits | the prompt **asked** it to behave | the harness changes instead — no cooperation needed |
| Finishing | "all done" | what changed, and what proves it. **Including what doesn't** |
| Where you use it | one more terminal window | inside your editor (Zed · JetBrains · Neovim · Emacs) |
| Review paperwork | one document, for humans | SBOM · egress list · audit spec — **straight into a scanner** |
| Keys | one `env` and they were in the conversation and on disk | masked where output enters. Files are **deliberately** left alone |

<br>

#### 1. Rules that must hold were vanishing into the fold — `/pin`

Long conversations fold and summarise earlier turns to make room. A 2026 measurement found
**summarisation preserves only about 50% of safety constraints.** If "never touch this
folder" lands in the missing half, the model is in a state where it was never told. Nothing
appears on screen.

Pinned lines are **not kept with the messages.** They are appended to the end of the system
prompt — and since folding and compaction only touch messages, they are structurally out of
reach. Not carefully preserved: **impossible to remove.**

```
/pin never touch src/legacy

  ✓ Pinned — 2 now (78 tokens)
```

Up to 12 lines / 240 tokens. Past that it says so and carries the most recent — dropping
them quietly would defeat the point of pinning.

#### 2. Observed habits stayed as words — `/model 카드`

deel already watched what the model did. But watching was all it did — it **wrote advice
into the prompt**: "you keep truncating arguments, use Append." Small models don't follow
that advice. That is what makes them small models.

Now what it observes becomes **harness settings**. Instead of asking the model, deel changes
its own behaviour.

| Observed | What changes |
|---|---|
| Arguments truncate often (over 15%) | The cap is raised up front — no wasted first call |
| It repeats itself | Three identical calls tolerated becomes two |
| Edits miss often | More surrounding lines are shown on a near-miss |

**Nothing changes before 12 steps.** Pinning down a healthy model because of one unlucky
truncation is worse than not learning at all.

#### 3. Evidence instead of "all done" — `/evidence`

A 2026 survey found **96% of developers don't fully trust AI-written code, while 48% verify
it every time.** 38% said it is harder to review than human code.

Why harder? Ask a person why they wrote it that way and you get an answer. Agent-written
code arrives with **one line: "done."** That line cannot be reviewed.

```
/evidence

  Changed         3 files · +142 −38
  Ran             5 commands (1 failed)
  Unproven        1

  ✗ src/worker.js — the last `npm test` failed — an earlier pass
                    does not prove the current state.
```

Listing what changed is something `/diff` already does. What only this does is **say that
the unproven is unproven.** Three things get caught —

- Changed something and ran nothing? Nothing was proven
- Counting a red test as green means **offering a failing test as evidence**
- A check run *before* the edit proves nothing about it — "I ran it earlier" is the most
  common form of self-deception

If the build passed and the tests broke *after* it, the earlier green is not evidence. The
last thing you ran is red; it cannot have been verified.

`/evidence filename` writes it as markdown under `.deel/증거/`. The screen scrolls away, and
the review happens later, by someone else.

#### 4. It made you open one more terminal — `deel acp`

Developers live inside the IDE. A tool that makes you switch windows stops being used after
about two weeks. A build that cleared corporate review and then nobody uses is the saddest
possible outcome.

deel now speaks **ACP** (Agent Client Protocol). One line — `deel acp` — in your editor's
settings and Zed, JetBrains, Neovim and Emacs attach **without changing a line on their side**.

The work isn't connecting the pipe; it is **making the editor able to show something**.
Kind, location and status are all optional in the spec, so a quick implementation omits all
three — and then every tool is the same grey dot and no changed file is clickable.

Approval flows through too. deel's safety rails render as the editor's own dialog, and
"always allow" is remembered for that session. Against a client that cannot ask, it
**does not run** — "if I can't ask, I do as I please" is not an option.

**Still zero dependencies.** Newline-delimited JSON-RPC 2.0 is the whole transport, so no SDK.

#### 5. Review paperwork only a human could read — `deel sbom`

A Korean financial-sector rule change on 2026-04-20 opened an exemption to the network-
separation mandate. The paperwork demanded at that door is not prose — security feeds an
**SBOM to a scanner** for a vulnerability list, and operations reads the audit-log spec to
write SIEM ingestion rules.

`deel pack` now emits three documents.

| | |
|---|---|
| `반입심사서.txt` | The human-readable sheet, as before |
| `sbom.cdx.json` | CycloneDX 1.5. One component per file with SHA-256. Dependencies as an **explicit empty array** — "not declared" and "none" are different claims |
| `심사명세.json` | Egress list (per lane: when, where, what, how it's stopped, source location) · audit-log spec · file hashes |

All three are generated by scanning the source. The audit-log spec is the one hand-written
part, so **a test compares it against real log records on every run** — a review document
that drifts is worse than none, and one wrong line costs you the reviewer's trust in the rest.

#### 6. One `env` put your keys in the conversation and on disk

People rarely paste a key. The leak is almost always command output — `env`, `git remote -v`,
`curl -v`, a failing test log. That text goes to the model **and** is written to
`.deel/sessions/*.jsonl`. Leak once, and you have several copies.

Masking now happens at the single point where tool output enters the conversation:
private-key blocks, OpenAI, Anthropic, GitHub, Slack, AWS, Google, JWTs, credentials in URLs,
`Authorization`-family headers, and env vars named `…KEY` / `…TOKEN` / `…SECRET` /
`…PASSWORD`. The configured gateway key is removed regardless of shape — that one is a known
value, not a guess.

**File contents are deliberately not masked.** Mask `.env` and the model edits the masked text
and writes it back, landing a placeholder where the real key was — protecting the secret would
destroy it. So on the file side it reports instead of rewriting.

<br>

Tests 2,578 → **2,860** · 54/54 files. Earlier releases are on the [tags](https://github.com/jysvai/deel-local-cli/tags) page.

## 1.2.0

**so the conversation doesn't break**

<br>

| | Before | After |
|---|---|---|
| Resuming | a conversation cut mid-tool-call **would not reopen** | unmatched calls are cleared, then it opens |
| Counting tokens | it guessed, and stayed wrong | it corrects itself against the server |
| Making room | summarising arrived at turn 49 | it holds out to turn **102** |
| Side questions | piled up in the main context | live in their own thread |
| Yesterday's lesson | vanished when you quit | carries over to the next session |
| The answer on screen | `**bold**` showed up as characters | it is drawn |

<br>

#### 1. A conversation cut mid-tool-call would not reopen

Close the window or hit <kbd>Ctrl</kbd>+<kbd>C</kbd> while a tool is running and the saved conversation keeps **a call with no result under it**. Reopen it with `--resume` and the server rejects the mismatch with a 400 — the conversation was written down perfectly well, and you still could not carry on.

Now the pairs are checked before it opens. Calls with no result go, results with no parent go, and **whatever the model said stays.**

```
$ deel --resume 20260826-140217

  ✓ 20260826-140217 — 메시지 48개를 이어 받았습니다.
  중단된 도구 호출 2개를 걷어냈습니다 — 그때 하던 일은 다시 시켜 주세요.
```

#### 2. It misjudged the room left

Token counts are estimated from character counts. Mix Korean, code and JSON and that estimate drifts from the truth — so deel folded early with room to spare, or did not fold when there was none and the server refused.

It now **corrects the multiplier against what the server actually reports** with every answer. One line at the foot of `/context`:

```
  서버가 알려 준 실제값에 맞춰 +12% 보정했습니다 (7번 재봄).
```

The multiplier is kept per model, so **the next session starts from it** instead of measuring again from scratch.

#### 3. Summarising arrived too early

At 80% of the window, earlier turns get folded into a summary. That **cannot be undone**, and the file contents the reasoning rested on are gone with it.

There is now a step before it. At 55%, **only older tool results** are folded — the four most recent are left alone, and nothing the model or you said is touched at all.

```
  ◲ 오래된 도구 결과 6개를 접었습니다 (2,148 토큰을 비움)
```

What was there is left in its place:

```
  (접힘) Read(src/runner.js) — 61줄. 자리를 비우려고 내용을 접었습니다. 필요하면 다시 읽으세요.
```

Measured by streaming the same conversation through: summarising is pushed from **turn 49 to turn 102 — 2.1×**.

#### 4. Side questions polluted the main line

"Just check this one thing" piles into the main context and stays there long after the checking is done.

```
/thread new 로그확인
  ⑂ 로그확인 갈래로 왔습니다. 빈 대화입니다
  본줄기로 돌아가려면 /thread 1
```

`fork` carries the conversation so far with you. What threads **keep apart is the messages, the token count and the checklist**; what they **share is the connection, undo and the audit log** — a file changed inside a thread still comes back with `/undo`. The `⑂` marker appears in the status line only once there is more than one thread.

#### 5. Yesterday's lesson vanished when you quit

deel could work out that `pnpm` is not on this machine, and lose it the moment you quit. Tomorrow it calls it again, fails again, works around it again.

```
/learned
── 겪어 본 것 ──────────────────────────────────────

  이 폴더에서 돌려 본 명령
    ✓ npm test                 됨 12 · 안 됨 0
    ✗ pnpm                     됨 0 · 안 됨 3

  이 모델에 대해  qwen2.5-coder:7b
    같이 걸어 본 걸음             86
    인자가 잘림                   14  (16%)
    토큰 추정 보정             ×1.12

  이 중 프롬프트에 실리는 것
  - 여기서 되는 명령: `npm test`
  - 이 PC 에서 안 되는 명령(다시 부르지 마라): `pnpm`
```

**This is not training.** It does not touch the model and it does not hoard conversations — that would only eat context. It counts, and it carries over **only what it has seen twice**, all of it **within 220 tokens**. Something seen once may be a coincidence, and writing a coincidence down as fact sends the model around a road that actually works.

Commands that work live with the folder (`.deel/배운것.json`); the model's habits live in the config folder. So **move the folder and what it learned about the model comes along.** `/learned 지우기` empties it whenever you want.

#### 6. The answer showed up as raw characters

The model speaks Markdown and the screen did not know it, so asterisks, backticks and hashes came through mixed into the prose. You had to re-read it in your head to see what was a heading and what was code.

```
before                                 after
▌ ## 고친 것                           ▌ ▍ 고친 것
▌ **src/runner.js** 의 `console.log`   ▌ src/runner.js 의 console.log
▌ - [ ] 남은 것: `src/worker.js`       ▌ ☐ 남은 것: src/worker.js
▌ ```js                                ▌ ┌──────────────── js
▌ log.info('시작', { id })             ▌ │ log.info('시작', { id })
▌ |---|---|                            ▌ ┼────────┼─────────┼
```

Answers arrive in fragments, so a line can only be drawn **once it ends**. But a whole paragraph on one line would leave the screen still for seconds — so once a line grows past the screen width, everything up to there is **streamed raw**. Looking alive comes before looking neat.

<br>

Tests 2,532 → **2,578** · 48/48 files. Earlier releases are in the [tags](https://github.com/jysvai/deel-local-cli/tags).

---

[← back to README](../../README.en.md)
