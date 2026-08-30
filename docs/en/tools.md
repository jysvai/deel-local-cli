[← back to README](../../README.en.md)

# Tools in depth

Outline, Verify, Task, Jobs, Append, Def/Refs, edit matching, diagnostics

---

## Tools

<sub>Outline · Verify · Task · Def · Refs · Commands that never finish and 9 more</sub>

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

### Which shell on Windows — bash when Git Bash is there

On Windows, `Bash` looks for **Git for Windows' bash** first — `%ProgramFiles%\Git\bin\bash.exe`, or a
`bash.exe` on PATH (`System32\bash.exe` is skipped: it launches WSL). Otherwise it is `cmd.exe`. Either
way the model is told in one `Shell: …` line, so it stops typing `ls` into cmd and losing twenty seconds
per miss. `/status` shows the same line. Override with `DEEL_SHELL=bash|cmd|powershell` or `"shell"` in
the config file — PowerShell is used only when asked for (Windows PowerShell 5.1 does not know `&&`).
Under bash, `/c/Users/…`-style paths pass the scope check when they point inside the working folder.

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

### With a language server, it sees meaning — `Def` and `Refs`

`Grep` finds **text**; a language server knows **meaning**. Grep for `run` and you get the
`run` in a comment, the `run` in a third-party library, the `run` inside a string. Which of
those actually call that function is something a person has to open one by one. The model
cannot afford that, so it edits based on the first few hits, and **the ones it missed only
surface once you run the thing.**

```
⏺ Refs(add_up)
  add_up — used in 3 places · 2 files

  src/use.py (2)
    4: return add_up(1, 2)
    9: return add_up(x, x)
  src/other.py (1)
    2: value = add_up(9, 9)
```

`Grep` stays. When you rename something outright you actually need it — a language server
does not look at comments, config or docs. These two **add to** what was here; they do not
replace it.

They take a **name**, not a position. LSP asks "this file, this line, this column", but the
model does not know the column. Finding out means reading the file first, and that throws
away the whole point of the tool. So it resolves the name through `workspace/symbol` first
and asks again at that position. When a name exists in several places you get **the list** —
it does not pick one and pretend.

### It checks the file you just edited

`Verify` stays too. They do different jobs.

| | When | What |
|---|---|---|
| `Verify` | Once, before you finish | **Syntax** (`node --check`, `py_compile`) |
| Post-edit diagnostics | Right after an edit, that file only | **Meaning** (undefined names, wrong types, missing arguments) |

Some things are syntactically fine and still wrong. `node --check` passes all of them.

```
⏺ Write(pkg/bad.py)
  3 lines
  language server — pkg/bad.py: 2 errors
    line 1 error: Type "Literal['x']" is not assignable to declared type "int"
    line 2 error: "missing_name" is not defined
```

Until now that only showed up **once something was run**, and running goes through user
approval, so it was several steps later. In between, the model treats that file as finished
and moves to the next one. When the error finally surfaces you have to trace back, and
tracing back costs more than the fix.

When everything is fine it **says nothing.** A line of "0 errors" after every edit fills the
window. And not receiving diagnostics is not the same as having none — when nothing came
back, it says nothing rather than inventing an answer.

### It installs nothing

**deel does not install language servers.** It scans PATH; if one is there it uses it, and
if not it falls back to `Grep` and `Outline`. This program exists for places where you cannot
bring in unapproved software, so a tool running `npm i -g` on its own is out of the question.

With no server, `Def` and `Refs` **do not appear in the model's tool list at all** — the same
way web tools are hidden offline. Leave an unusable tool standing and the model calls it,
gets "not available", and calls it again. That round trip costs more than the schema does.

`/lsp` shows you what is there.

```
$ /lsp

  ◈ 2 language server(s) on this machine
     ✓ ts    typescript-language-server
     ✓ py    pyright-langserver

  Language of this folder: py · 12 files
  Tools: Def · Refs
  Diagnostics after an edit: on
  Turn post-edit diagnostics on or off: /lsp on · /lsp off
```

It looks for `ts`, `py`, `go`, `rs`, `java`, `cs`, `cpp`, `rb`, `php` and `lua`. When one is
missing it prints the install command **as text only.** Whether to run it is your call.

<details>
<summary>Four things a real server (pyright) taught us</summary>

A stub server alone would have shown green for all of these.

- **Servers spell URIs differently than we do.** We send `file:///C:/…`; pyright answers with
  `file:///c%3A/…` — lowercase drive letter, percent-encoded colon. Compared as strings they
  never match. Diagnostics arrive correctly, are not found in our table, and become "nothing
  came back" — and **saying nothing means the file is sound**, so a broken file gets reported
  as fine. We compare paths, not URIs.
- **A server that just started answers empty.** Not because the name is missing but because
  it has not finished indexing. Asked 0.2s after startup it said no; 0.5s later it said yes.
  Turning that into "no such name" makes the model create something that already exists. So
  it asks again a few times, but only while the server is young.
- **npm installs two names on Windows.** An extension-less sh script and a `.cmd`. Find the
  first one and the file plainly exists, so it reports "installed" — but Windows cannot run
  it. Claiming it is there and then failing is the hardest failure to spot.
- **`cmd /s /c` strips the outer pair of quotes.** Wrap the command once and it breaks
  entirely, and all you see from the outside is "no language server".

</details>

---

[← back to README](../../README.en.md)
