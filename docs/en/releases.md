[← back to README](../../README.en.md)

# Release notes

What changed in each version, and why

---

## 1.5.4

**The office fills up, and a day passes in it**

After 1.5.3 shipped: "is it fixed at one person? whatever I ask for, only one
shows up." It wasn't fixed — it was a bug. This fixes it, and since the room was
also called too bare, a day now passes in it.

#### 1. The office only ever had one person in it

Whatever you asked for, exactly one seat filled. Seats were counted as "the
parent, plus each running **subagent**" — but subagents run one after another;
the next one does not start until the previous finishes. So that count was
effectively 0 or 1.

What actually runs concurrently is the **parallel read batch** — the one that
reads three files at once. Its size was already on screen as "running 3
together"; the room just never looked at that number.

Now it fills that many seats. The postures aren't invented either: only
read-only tools are ever batched (Read, Glob, Grep, Skill, WebFetch), so those
seats genuinely are reading. What a subagent is doing never reaches this layer,
so those seats stay "idle" — unknown is left unknown.

#### 2. A day now passes in the room

The window had two states, day and night. So 5% of context and 50% of context
were **the same bright afternoon** — twelve rows of screen saying nothing.

There are four now: **morning → day → dusk → night**, turning at 25%, 55% and
80%. The sun rises low in the east, climbs at midday, sinks in the west, and
becomes the moon. Dusk means start wrapping up; night means you already should
have — and you see it out of the corner of your eye without reading a number.
The walls and floor dim along with it (people and desks do not — reading the
seats is the reason this room exists).

Along with it:

- **A wall clock** — how long this turn has taken. One lap per minute, so by the
  second lap "this is taking a while" arrives before you count anything. It is
  only hung when there is space left over after the windows; losing a window to
  a clock would be a bad trade.
- **A cold coffee** — appears on a seat past 45 seconds. It is the **same
  number** as the doze, shown twice. The sleeping posture half-hides behind the
  monitor, so on a narrow terminal "asleep" and "empty" looked alike. The mug
  doesn't hide.
- **Up to two sheets of paper per desk** — it used to be one per desk, so a
  five-seat room capped at five. Editing six files and editing twenty looked
  identical.
- **Drifting clouds and blinking stars** — these two alone are not numbers. They
  only say the room hasn't frozen, so they move very slowly. Anything faster
  pulls your eye away from the seats, the notes and the lamps, which are the
  parts worth reading.

The rule holds: everything on screen is a real number. Each new thing comes from
somewhere real, and what isn't known is still left at zero.

Rows that actually change between frames went from an average of 0.4 of 12 to
**about 0.5** — that is what the clouds and stars cost.

#### 3. There are two screens and nothing compared them

Fixing #1 added one method to the box screen only, and the plan-approval flow
under `--no-tui` **broke outright**. The syntax check passed. The box tests
passed. Nothing anywhere checked that both screens understand the same calls.

A test does now. If a method exists on the box screen and not on the line
screen, it stops there.

---

## 1.5.3

**Three things a Mac user tripped over**

Nothing crashed. Every one of these is the "I thought this worked and it
doesn't" kind — no error, no failing test, wrong only on screen, and therefore
long-lived.

The first three are what a Mac user hit. The fourth surfaced while fixing them.

#### 1. `Shift+Enter` / `Ctrl+Enter` / `Cmd+Enter` didn't insert a newline on macOS

**They still won't.** This one can't be fixed, so here's why.

What a terminal sends a program is not "which key was pressed" — it's **bytes**.
And all three of these send **the same bytes as a plain Enter**: a single `\r`.
There is nothing on the program side to tell them apart. Same on macOS, Windows,
and Linux.

`Alt+Enter` (`Option+Enter` on a Mac) is the one exception: it arrives with an
`\x1b` in front, as `\x1b\r`, so it *is* distinguishable. But **macOS terminals
don't send Option that way by default** — Option is reserved for composing
characters (´ø∑).

So this release:

- Moves the **``` ` ```(backtick) method to the front of the hint**, because it
  works everywhere. End a line with a space + `` ` `` and press Enter to
  continue on the next line. No terminal settings involved.
- Documents the **"send Option as Meta" setting** per terminal in
  `docs/en/interface.md` — Terminal.app, iTerm2, VS Code. Warp, Ghostty and
  WezTerm usually work already.

#### 2. The office disappeared while an answer streamed in

As soon as a plan appeared or the model started talking, the office below went
away and did not come back until the answer finished.

Every appended chunk erased the box and **never redrew it**. An answer that
streamed for 30 seconds meant 30 seconds with no office.

Now the box is redrawn whenever a line completes. The people below keep moving
for the whole answer.

The limit, stated plainly: while **one very long line** streams character by
character, the office is still briefly gone until that line ends. Removing that
entirely would require claiming the terminal's scroll region (DECSTBM), which
would stop scrolled-off conversation from reaching scrollback. deel keeps its
promise that "the conversation just flows into the terminal" instead.

#### 3. There was no obvious way to turn on the knight or animal themes

It was two environment variables (`DEEL_MOTION`, `DEEL_OFFICE`). You had to
remember both names, and changing one meant restarting the terminal. If turning
on something that exists for fun costs that much, nobody turns it on.

They're now one command:

```
/motion            what's on now + what you can pick
/motion knight     ⚔ knight and dragon
/motion animal     🐢 tortoise and hare
/motion office     people at work in an office (wide terminals only)
/motion off        nothing animates
/motion plain      dot spinner
```

Picking one **takes effect immediately** — no restart — and the choice is saved,
so it's still there next time.

The environment variables still work. They're for looking at something different
just once, and **the environment wins over the setting**. If one is set,
`/motion` says so. And `/motion` never **deletes** a `DEEL_NO_MOTION` you set
yourself — animation running where you believe you turned it off is the worst
possible outcome.

The office won't turn on in a small terminal (under 28 rows or under 60
columns). `/motion office` there tells you your current size and the size it
needs.

#### 4. Along the way — Korean particles now follow the value

Building `/motion` produced "기사 **으로** 바꿨습니다" — a Korean postposition
hard-coded into a sentence whose inserted value changes. Nothing crashes, no
test catches it, it is only wrong on screen, so it survives a long time.

Screen text now picks the postposition from the value's final consonant. `/lang`
and the status-bar hint had the same bug and are fixed too. Lists also align by
**display columns** rather than character count — a Korean character is two
columns wide, so the 사무실 row alone used to sit two columns off.

---

## 1.5.2

**Everything else the adversarial reviews turned up**

1.5.1 pulled out only the three defects that wrecked the screen. This clears the
rest of what the same reviews (Claude, codex, agy) found. Most of them are places
where **the screen was lying** — claiming something that could not happen, or
hiding something that did.

#### 1. The documented "they doze off past 45 seconds" had never once happened

Long-running work was supposed to make the people in the room slump over their
desks. **Nothing could reach that code.** The doze pose is selected when
`일감.갈래 === '느긋'`, but the kinds that arrive are only `생각`/`답`/`하위`/
`접기`/a tool name — never `느긋`. The in-box spinner was measuring elapsed time
in its own place and never passing it down.

The room now checks the clock itself, and past 45 seconds people actually slump.

The embarrassing part: a test was covering this up by feeding in a hand-built
`{갈래:'느긋'}` that production never constructs. A test that passes on an input
which cannot occur is guarding nothing.

#### 2. The 256-colour gate was dead code, and `NO_COLOR` was ignored

The docs promised the office stays off where 256 colour is unavailable. That
decision was a single check, `TERM !== 'dumb'` — but **the box itself already
refuses `dumb`.** Inside the box the gate was always true, so it never fired
once, and a 16-colour console got the office anyway.

`NO_COLOR=1` was not consulted at all. A screen that is nothing but colour was
being drawn for people who had turned colour off.

It now turns on only when colour support is **positively identified**, and stays
off when unknown — failing closed costs you a hidden office, failing open spills
colour codes into your text as literal digits.

#### 3. Emoji were being cut in half

```
접어쓰기("a😀", 2)  →  ["a\ud83d", "\ude00"]
```

Text was walked one UTF-16 unit at a time, so a line could wrap **through the
middle** of a two-unit character. It renders as two replacement characters, and
every width calculation after it is off.

Wrapping now takes a whole visible cluster at a time. Skin-tone modifiers (👍🏽)
and ZWJ sequences (👨‍👩‍👧) survive too.

#### 4. Self-healing was counted in keystrokes, not seconds

Sending only changed rows assumes the screen still looks the way we remember. To
keep the old full-redraw's self-repair, a whole frame goes out every four seconds
— except it was counted as **45 draws**.

While work is running the box draws every 90ms, so that really was four seconds.
But **when idle it draws only on a keystroke.** There, four seconds meant "45 more
keys", and a screen corrupted while you sat still never healed at all. It is on a
clock now.

#### 5. Resizing the window desynchronised the screen

Nothing anywhere noticed a size change. The moment the width changes the terminal
reflows rows on its own, while the box keeps moving the cursor by counts taken at
the old width — landing on the wrong rows and wiping conversation. Nothing repaired
it until the line count happened to change.

Each draw now compares against the last size and drops the cache when it differs.
Not using the `resize` event is deliberate: a listener per box needs somewhere to be
removed (an EventEmitter warning otherwise), and some environments never fire it.
The moment it costs anything is **the next draw**, so checking there is enough.

Right after shrinking a window the old box may be left above. That is just a mark
that scrolls away — **better than guessing at rows whose position we no longer know
and overwriting them.**

#### 6. On short terminals the pinned region overflowed the screen

The 28-row threshold assumed "12 office + 5 box", but the box gets bigger than
that: long input wrapping to eight rows, plus the completion list and the context
warning, is 32.

Raising the threshold to 34 would cost the office to people it currently works
fine for. Instead the office is dropped **for that frame only**, and comes back
by itself once there is room.

#### 7. Numbers in the room saturated silently

- **Todos**: only five sticky notes, so "ten done" and "ten done, one left"
  both rendered as five green notes — outstanding work vanished. A yellow note is
  now always reserved when anything is left.
- **Model calls**: six and a hundred were both a full row of lit lamps. When it
  saturates, the last lamp changes colour.
- **Active workers**: on a narrow screen, two running and three running drew the
  same picture. The last desk now carries an overflow mark.

#### 8. Subagent desks mimicked the parent's posture

The rule for this screen is that **everything is a real number.** But subagent
seats were given a copy of the parent's posture — when the parent was typing, a
subagent that was reading files also typed. The seat *count* was real; the posture
was invented.

What a subagent is doing does not reach this layer, so those seats now sit in a
neutral waiting pose. Better to show that we don't know than to make it up.

#### 9. `--no-tui` advertised shortcuts that do nothing there

The header offers `Shift+Tab` and `Alt+Enter`/backtick continuation, all three of
which live inside the box. On the line screen, through a pipe, or in CI, it was
**telling people about things that don't work.** Those lines now appear only with
the box.

#### 10. Performance figures that didn't reproduce were removed

"10 KB/s → 1.6 KB/s, 0.09% of a core" was published. Measured again, those numbers
did not come back — they swing by several times with terminal width and with
whatever happens to be animating.

The absolutes are gone; what remains is what the code always guarantees. Rows that
change per frame average 0.4 out of twelve, and **even on a worst-case frame where
everything changes, diffing emits the same bytes as a full redraw.** There is no
case where it loses.

#### 11. Tests now measure the seam

Until now the office was only ever measured on its own. That is why 1.5.0's
critical defect — 60 columns rendered into a 50-column terminal — passed the
suite: nothing checked what those rows did **once the box laid them out.**

Rendering now goes through `프레임()` in the tests. The box test's "the border
survives deletes" was fixed too: it was searching output accumulated since process
start, so it passed even if the border had vanished from the current screen. It
now reads the very frame where self-healing runs.

---

## 1.5.1

**Two of the things 1.5.0 added shipped broken. This fixes them**

After 1.5.0 went out it went through three adversarial reviews (Claude, codex,
agy). All three suspected the same code and all three named the wrong cause.
There were no tests for it — and on screen, both features looked fine.

#### 1. Multi-line messages written with `Alt+Enter` arrived reversed

Typing `hello` → Alt+Enter → `there` sent the model `there\rhello`. With three
lines the order was fully reversed.

What the box drew was correct the whole time. The corruption happened at the
moment of sending: readline's history split the newline held inside `rl.line`,
stacked the pieces backwards, and rejoined them with `\r`.

The fix is to keep newlines out of `rl.line` entirely. The trailing-backtick
continuation already worked that way, so `Alt+Enter` now uses the same buffer.

#### 2. A trailing backtick swallowed ordinary requests

```
read `config.json`     never sent — stuck in continuation mode
echo `date`            closing backtick torn off
explain `npm test`     never sent
```

Any line ending in a single backtick counted as a continuation. In a coding
tool, lines that end in inline code are common. To the person typing, **Enter
simply stopped working.**

Now it counts as a continuation only when the backtick is **preceded by
whitespace and is the only backtick on the line.** Inline code has two, so it
no longer matches.

`Ctrl+C` now discards a pending continuation. Before, there was no way to
cancel one: once armed, whatever you typed next was glued onto the previous
line — including `/help`, which then no longer started with `/`, so it was
sent to the model instead of being run as a command.

#### 3. The office wiped the screen on narrow terminals

The room always uses 60 columns, but the decision to turn it on **checked rows
and never columns.** On a 50-column terminal the twelve rows folded into
twenty-four while the box still counted twelve and moved the cursor up by
twelve. Each frame landed in the wrong place; at 50×40, two hundred frames left
neither borders nor conversation.

It now stays off below 60 columns, and off when the terminal size is unknown.

The embarrassing part: a test was passing this overflow as *correct* — under
the name "doesn't blow up even when very narrow". That test is now inverted and
asserts no row is ever wider than the terminal.

#### 4. The missing tests

These defects survived three reviews because nothing tested them. `newline.test.js`
is new, and it measures **what gets sent, not what gets drawn.** It also pins down
why the old approach was wrong, so putting a newline back into `rl.line` fails
immediately.

---

## 1.5.0

**Line breaks exist now, the screen got fun, and it came out lighter than before**

#### 1. Line breaks — `Alt+Enter`, or end a line with `` ` ``

There was no way to send several lines as one message. Shift+Enter and
Ctrl+Enter just submit. That was not user error — no such code existed.

Feeding raw bytes through readline showed why Shift+Enter cannot work: most
terminals send it as **the same bytes as a plain Enter** (`\r`), and readline
receives them before we do and ends the line. There is no moment to intercept.
Escape-prefixed combinations (Alt/Option+Enter) are the exception — while
readline waits to see what follows the ESC, our handler gets there first.

If your terminal won't send Alt+Enter either, end the line with `` ` `` and
press Enter. That works anywhere. Backtick rather than backslash is deliberate:
Windows paths routinely end in `\`, so a pasted path would read as a
continuation. Only a **single** trailing backtick counts, so a markdown code
fence (` ``` `) passes through untouched.

#### 2. Themes for the working animation — a knight, and pixel animals

```bash
DEEL_MOTION=knight
DEEL_MOTION=animal
```

The knight swings a sword while code is being written, advances behind a shield
while reading, and past 45 seconds **collapses from exhaustion and gets back
up.** The animals walk, hop and stretch, then lie down to sleep on a long wait.

Pretending a long wait is nearly over makes it feel longer; going still reads as
crashed. Falling over is neither.

The default drawings are untouched. Choose nothing and nothing changes.

#### 3. The office — what is running, drawn as a room

```bash
DEEL_OFFICE=1 deel
```

A twelve-row room pins above the input box and comes alive when work starts:
seats fill, people type, people read, and past 45 seconds they doze off.

**Everything on screen is a real number.** Occupied seats are the work running
now (the parent plus each subagent), whiteboard notes are todos, cabinet drawers
are files read, server lights are model calls, and the daylight in the windows
is how full the context is. What isn't known stays zero — invent one number and
the whole screen stops being worth trusting.

Off by default, and it stays off below 28 rows (twelve rows of office plus five
of input box leaves nowhere for the conversation). Turning it on quiets the
in-box knight or animals back to a plain spinner — both say the same thing, and
stacked together they just say it twice.

#### 4. And the box got six times lighter

Measuring before adding the office: sending twelve rows every 90ms is 104KB/s.
But only **one of those twelve rows** actually changes between frames — walls,
windows, cabinets and empty desks do not.

So the box now compares row by row and sends only what changed. **That speeds
things up even if you never turn the office on.**

Rows that actually differ between frames: **0.4 out of twelve** on average. Even
on a worst-case frame where everything changes, diffing emits the same bytes as a
full redraw, so there is no case where it loses.

> A table of KB/s figures used to sit here. It was removed in 1.5.1 — the numbers
> swing by several times with terminal width and with whatever is animating, and
> they did not reproduce when measured again.

Comparing rows trusts that the screen is what we think it is, which gives up the
self-healing that redrawing everything provided. So every four seconds it still
redraws in full.

#### 5. A test that passed once and failed the next time on identical code

The box test spawns a real deel and reads the screen, but decided *when* to read
by **clock** — sleep 1800ms, then look. On a busy machine it hadn't started yet,
so the test read a blank screen and called everything broken. Fifteen runs of
identical code produced three failures.

It now waits for **things that happened** instead: the startup signal, the answer
arriving, the expected text appearing. Three failures in fifteen became zero, and
because it moves on as soon as the signal lands, it is usually faster.

## 1.4.3

**The README explains what's different, and the review report gets its missing line**

Two pieces of feedback from the Reddit post, addressed.

#### 1. "What's different" at the top of the README

Every section already explained a feature, but nothing said which of them
don't exist elsewhere, or why. Seven differentiators — `/undo` rewinding the
conversation, prefix-cache survival, edit-match success going 20%→100%,
advance knowledge of Korean models, and more — now get a quick-scan table
up top, with the reasoning spelled out below each.

#### 2. `--offline` blocking MCP is now documented — the code already did it right

Someone asked whether MCP servers get shut off under offline mode too, or
whether a local-only model still leaves a tool free to make its own network
calls. The code was already correct: offline doesn't filter MCP requests —
it never spawns the server process at all, because there's no way to see
what sockets someone else's binary opens. The gap was that the README never
said so. The same gap existed in the actual report `deel audit`/`deel pack`
produces, so that got fixed too, since that's the document that goes to a
security reviewer.

While fixing it, the "54/55 network+web checks" citation turned out to be
stale — updated to the real count (76, plus 47 mcp checks = 123).

## 1.4.2

**1.4.1 shipped before its own security fixes — this corrects that**

Right after fixing the publish-workflow bug (bash couldn't parse Korean
variable names), 1.4.1 published to npm **before** the security fixes listed
under 1.4.1 below actually landed in the code. So as of this writing,
`npm install -g deel-local-cli` at 1.4.1 shipped the ReDoS in guard.js and
the XSS in the preview server as-is. npm won't let a version publish twice,
so this release exists to actually carry those fixes. The code is identical
to what 1.4.1 describes below — install 1.4.2 or later to get it.

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
