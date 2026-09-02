[← back to README](../../README.md)

# The screen

Commands, the input box, work modes, simple vs developer, what it asks about

---

## Slash commands

<sub>Attaching a file with @ · /commit · Interrupting</sub>

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

### Showing a screenshot

`.png` · `.jpg` · `.gif` · `.webp` are sent **as images**, not as text — the same for
`Read shot.png` and for `@shot.png`.

```
> @error-screen.png what is going on here?
  |= attached error-screen.png (image · 340KB)
```

Whether the connected model can see images is settled on first connect by asking it about a
**1x1 white dot** (the `Vision` row in `deel setup`). Names are not trusted for this: a
corporate gateway can put anything behind the name `gpt-4o`, and locally pulled models are
named however their author felt.

**A model that cannot see gets no bytes at all.** Sending anyway earns a 400, or worse, the
server quietly ignores the image and invents an answer — and then the user believes the model
looked at the screen. Instead it says so in one line.

| | |
|---|---|
| Per-image cap | 4MB. Over that it is not sent, and the size is named. It is not downscaled — installing nothing is this tool's rule |
| Named .png but actually a JPEG | The bytes decide the type. Trusting the name earns a 400 from the gateway |
| A saved image URL that was really a login page | Says it is not an image |
| When the window fills | Old images are dropped first (the last two stay). Words the user typed are never touched |

#### You don't have to save the screenshot — `/paste`

Asking about one error screen used to mean **capture → paint → save → find the path**. Those
four steps push people back to "let me just describe it." The capture is already on the
clipboard; it only needs fetching.

```
(Win+Shift+S to capture)

❯ /paste
  ◧ 클립보드에서 가져와 앉혔습니다 .deel/붙인그림/2026-03-04_05-06-07.png (182KB)
      (fetched from the clipboard and saved)

❯ @.deel/붙인그림/2026-03-04_05-06-07.png 이거 왜 이래?
```

`/paste` saves the image under `.deel/붙인그림/` and turns it into a single `@path` line.
Attaching is then done by the `@` path above, so budgeting and the no-vision case exist in
one place only. **It shows you which file is going out** — without that, the wrong capture
could be sent with nowhere to notice.

Nothing is installed. Windows uses PowerShell's .NET clipboard, macOS uses `osascript` —
both ship with the OS. Linux needs `wl-paste` or `xclip`, and if neither is there, it says
**which one to install**.

Three cases are kept apart: "no image on the clipboard" (capture again), "could not fetch
it" (reason and remedy given), and "this model cannot see images" (said before sending).
Collapsing them into one "cannot do that" leaves you with nothing to fix.

> It lives under `.deel/`, but **the key file `config.json` cannot be attached with `@`
> either.** Putting pasted images in that folder made it reachable by `@`, and what the
> `Read` tool had been blocking, `@` was not. Blocking the tool while leaving `@` open is
> not blocking. Both are closed now.

### `/commit` — records only what this session changed

Work only lasts once it goes through git. When the model takes that last step itself with
`Bash` and `git commit -m "…"`, three things leak: quoting breaks on Windows so the message
collapses to one line, `git add -A` sweeps in files someone was editing in another window,
and none of the evidence deel already has (`/evidence`) reaches the message.

```
❯ /commit
  담은 것 — 파일 2개
    · src/tools/ignore.js
    · test/ignore.test.js

  메시지
    feat: git 이 안 보는 것은 도구도 안 본다

    Glob 이 빌드 산출물을 그대로 훑어 답이 잘리고 있었다.

    검증: 2건 확인 · 0건 미확인
    Generated-by: deel 1.6.0 · qwen2.5-coder-7b

  ✓ 477b88b  feat: git 이 안 보는 것은 도구도 안 본다
     push 는 안 했습니다. 되돌리려면 git reset --soft HEAD~1
```

| Type this | What happens |
|---|---|
| `/commit` | stages only the files this session touched, then commits |
| `/commit 전부` (`all`) | stages every change in the working folder |
| `/commit 미리보기` (`preview`) | shows the message and status, commits **nothing** |
| `/commit <title>` | keeps your title verbatim, writes only the body |

The message is written from the **staged diff and the evidence**, not from the conversation.
Send the whole conversation and the model ends up citing its own words back at itself; what
goes into a commit should be what the code says. The repo's last ten subjects go along too,
so a repo that uses `feat:`/`fix:` gets that style and one that doesn't, doesn't.

If nothing was run after the edits, the message carries `검증: 0건 확인 · 1건 미확인`
(0 verified · 1 unverified). For whoever reads this commit later, that line is the only
record of what was actually checked at the time.

**It never pushes.** Between what can be undone (a local commit) and what cannot (somewhere
others can see), a person belongs. It also never quietly unstages what someone else already
staged — it says "these were already staged and will go in too" instead.

`전부` (all) means **the whole working folder**, not the whole repository. Started in a subdirectory of
a larger repo, it stays inside that subdirectory — sweeping in a neighbouring team's folder would also
send its contents to the model that writes the message.

Even `전부` leaves **`.deel/` out**: that is where the gateway key (`config.json`) and the
audit log live. A key that once landed in a commit stays in the history even after you revert it.
Anything that slipped in through a differently-named symlink is caught after staging, by resolving
the real path and unstaging it; if it cannot be unstaged, nothing is committed at all.

Whatever the model wrote is **filtered** before it goes in: terminal control characters (ESC) are
stripped — otherwise the preview you approve can differ from what gets written, and those bytes
replay later in someone else's `git log` — and trailers such as `Signed-off-by:` are dropped, since a
signature from a person who never signed is read as real by the tools that count them.

`/commit` runs the repository's `pre-commit` and `commit-msg` hooks, as git always does. In an
unfamiliar repository, look at what those hooks do before the first run.

No git, not a repository, or nothing to stage: one readable line, and it stops.

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

### Steering without stopping

Ctrl+C **throws away everything done so far.** But usually the thing you want to say is
not "drop it all" — it is "not that, this first." A local model can spend minutes on one
turn, and if what you type only lands after the turn ends, those minutes are already
spent going the wrong way.

**Just type it while it works and press Enter.**

```
❯ rewrite the whole test suite
  ◧ Read  test/smoke.js
❯ not that — look at the failing one first
  ❯ not that — look at the failing one first  (steered — takes effect from the next step)
  ◧ Read  test/loop.test.js
```

The line rides along on the **next call to the model**. Nothing done so far is thrown
away; only the direction changes. The request already in flight cannot be recalled, so
that one step runs to the end — everything after it is steered.

| | |
|---|---|
| A tool is running | It goes in **after** every tool result is attached. A user message wedged between a tool call and its result breaks the conversation shape, and the gateway answers 400 |
| You typed a slash command (`/mode`, `/undo`) | Not applied mid-turn. Those touch settings and files, and it would stop being clear which setting a given step ran under. It stays in the queue and runs when the turn ends |
| You typed it **before** the turn started | It stays the next turn, as always. Steering redirects the road being travelled; it does not pull forward what is waiting in line |
| Nothing appears on screen | It did not land. Anything accepted always prints the line above — without it people type the same thing again and it gets sent twice |

---

## Work modes

<sub>Switching by itself (Auto mode)</sub>

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

<sub>The input box · You don't have to type the whole command · The box stays while it works · The picture on the left moves too and 1 more</sub>

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
> flow, manage only the box. ([`test/box.test.js`](../../test/box.test.js) spawns a child that
> pretends to be a terminal, so this one cannot ship again.)

---

### Sending several lines as one message

**End a line with a space and a `` ` ``, then Enter** to keep going. The first
line that ends without one sends everything as a single message.

```
❯ take a look at these three `
   src/a.js `
   src/b.js
```

**This works in every terminal.** `Ctrl+C` throws away a continuation in progress.

The space in front is required so that an ordinary request ending in inline code
— `` read `config.json` `` — is not mistaken for a continuation. Those lines
getting swallowed was a defect in 1.5.0.

#### Why `Shift+Enter` does not work

**The terminal does not send that combination as anything distinct.**
`Shift+Enter`, `Ctrl+Enter` and `Command+Enter` arrive as the exact same byte as
plain Enter (`\r`) in most terminals, so there is nothing for a program to tell
apart — it is not that it wasn't built, it is that it never arrives.

`Alt+Enter` (`Option+Enter` on a Mac) is the exception: it comes through with an
ESC in front, which can be detected, and that is the one deel accepts.

#### When `Option+Enter` does nothing on a Mac

macOS terminals **do not send Option as Meta by default**, which is why every
combination appears to do nothing. Turning it on once is enough.

| Terminal | Where |
|---|---|
| **Terminal.app** | Settings → Profiles → Keyboard → check **`Use Option as Meta key`** |
| **iTerm2** | Settings → Profiles → Keys → Left Option key → **`Esc+`** |
| **VS Code terminal** | set `terminal.integrated.macOptionIsMeta` to `true` |
| **Warp · Ghostty · WezTerm** | usually send it already |

If you would rather not change anything, use the backtick above — it needs no
setup and works everywhere.

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

### Tab works in the shell too — `deel completion`

The above is for `/commands` typed **inside** a conversation. The things you type **before**
one starts — `deel sbom`, `--effort` — used to require reading the help text.

```
deel completion bash       > ~/.deel-completion.bash   # then source it from .bashrc
deel completion zsh        > ~/.deel-completion.zsh
deel completion powershell | Out-File -Encoding utf8 -Append $PROFILE
```

Once installed:

```
$ deel sb<TAB>
sbom

$ deel --mode <TAB>
auto  code  architect  ask  debug  plan  orchestrator

$ deel --think <TAB>
off  low  medium  high  max
```

The value lists for `--mode`, `--think` and `--effort` come **straight from the code**.
Copying them by hand means they drift eventually, and a completion that offers a value which
does not exist is worse than wrong help — help can be ignored, but completion insists the
thing is there. For the same reason, a test goes red if the command list stops matching the
commands the CLI actually accepts.

> **The PowerShell script is the one that is entirely in English.** Windows PowerShell 5.1,
> which ships with Windows, reads a BOM-less `.ps1` as the machine's legacy codepage (CP949
> in Korea). A double-byte decode there can **swallow a closing quote**, turning the whole
> script into a syntax error. Found by actually pressing TAB in a real PowerShell.

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

#### Changing the drawing

**Pick one with `/motion`.** It takes effect at once, and the choice is saved, so
it is still there next time. Typing just `/motion` shows what is on now.

```
/motion knight   ⚔ knight and dragon
/motion animal   🐢 tortoise and hare
/motion office   people at work in a room (below)
/motion off      nothing animates
/motion plain    back to the default drawings
```

| Value | What you get |
|---|---|
| `plain` | blobs, bars, scan lines — they tell you what is happening |
| `knight` (or `기사`) | **A medieval knight.** Swings a sword while writing code, advances behind a shield while reading |
| `animal` (or `동물`) | **Pixel animals.** They walk, hop, and stretch |
| `office` | A twelve-row room above the input box |
| `off` | Just the one-cell spinner |

The environment variables still work, for looking at something different just
once. **The environment wins over the setting** — `/motion` says so when one is set.

```bash
DEEL_MOTION=knight deel
DEEL_OFFICE=1 deel
```

The knight and animals use a 12×4 grid (six braille cells) — a figure or a creature drawn
into 6×4 reads as a smudge. Height cannot grow: the work indicator has to fit inside one
text row, and making it two rows changes the box height and the whole cursor calculation.
So they are drawn **in profile, lying along the horizontal**.

Past 45 seconds the knight **collapses and gets back up**, and the animal **lies down to
sleep**. The point is to stop pretending the wait is nearly over while keeping the screen
alive.

`DEEL_NO_MOTION=1` beats any theme — where braille does not render, a theme is no help.
An unrecognized name falls back to the default without complaint.

### The office — what is running, drawn as a room

```
/motion office
```

A twelve-row room pins itself **above** the input box. When work starts it comes alive
right there: seats fill, people type, people read, and past 45 seconds they doze off.

**One rule holds it together: everything on screen is a real number.**
Nothing is there for decoration.

| In the room | What it is |
|---|---|
| People in the room | Work running concurrently (parallel tool batch + subagents) **plus every outstanding todo** |
| Bright screen | Running right now |
| Dim screen | Taken on, but its turn has not come |
| Posture | Typing (writing), papers (reading), asleep (past 45s) |
| Someone walking about | Whoever could not get a desk. With three or more, one is always up |
| Mug on a desk | That seat has passed 45s (same number as the doze) |
| Whiteboard notes | Todos. Green is done, yellow is outstanding |
| Filing-cabinet drawers | Files read (one drawer per seven) |
| Server lights | Model calls made |
| Morning / day / dusk / night outside | How full the context is (it turns at 25%, 55%, 80%) |
| Wall-clock hand | How long this turn has taken (one lap per minute) |
| Paper on a desk | Files edited (up to two sheets per desk) |

What isn't known stays **zero**. It is never filled in with something plausible — invent
one number and the whole screen stops being worth trusting, and then those twelve rows
are just wallpaper.

#### When it stays off

- **Terminal shorter than 28 rows.** Twelve rows of office plus five of input box leaves
  nowhere for the conversation. Being unable to work because you wanted to watch the
  office has it backwards.
- **Terminal narrower than 60 columns.** The room always uses 60. Drawn any narrower the
  desks and people mash together and it stops reading as a room; drawn at 60 anyway, the
  twelve rows fold into twenty-four. The box still counts twelve and moves the cursor up
  by twelve, so the next frame lands in the wrong place and wipes the screen. Better to
  not show it at all.
- **When the terminal size is unknown** (piped output, for instance) — turning it on
  blind costs more than leaving it off.
- **`DEEL_NO_MOTION=1`** — that setting exists for screen-reader users.
- **Terminals without 256 colour** — the colour numbers would leak into the text.

Turning the office on quiets the in-box drawing (knight, animals) back to the plain
spinner. Both say the same thing — a knight swinging a sword means "writing code", and so
does an office worker at a keyboard. Stacked one above the other they just say it twice.

#### Is it heavy

No — and building it made the box **lighter than it was before.**

A whole frame is over 9KB, but very few of its rows actually change between frames
(walls, windows, cabinets and empty desks do not). So the box now sends only the
rows that changed, which speeds things up even if you never turn the office on.

How much lighter depends on **how many rows actually change between frames.**
In a quiet room (one thing running) it averages **0.5**; in a full one, **about
4**. Walls, windows, the filing cabinet and empty desks never change; only rows
with people in them do, so more people costs more — that is what the movement is
worth. `test/office.test.js` measures it.

| | |
|---|---|
| Rows changed per frame (quiet) | **0.5** out of 12 |
| Rows changed per frame (room full) | **about 4** out of 12 |
| Worst case (everything changes) | **byte-identical** to a full redraw |

No absolute throughput figure is published here. It swings by several times with
terminal width, with whatever happens to be animating, and with the terminal
itself — measure it once and write it down and it is simply a wrong number from
then on. What the code always guarantees is stated instead: **diffing can never
send more bytes than a full redraw.** On a frame where everything changed the two
emit the same thing; on any other frame it sends less.

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

---

[← back to README](../../README.md)
