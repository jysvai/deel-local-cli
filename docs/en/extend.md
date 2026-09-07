[← back to README](../../README.md)

# Extending

Skills, plugins, MCP, named subagents, hooks, inside your editor (ACP)

---

## Skills and plugins

<sub>Loaded in three stages · Fetching plugins · Deliberately not included</sub>

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

## Attaching tools from outside (MCP)

<sub>But this is somebody else's program</sub>

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

---

## Named subagents

<sub>One file holds the mode, the model, the tools, and the instructions</sub>

`Task` already exists. The problem is that **it has to be written out every time** —
which mode, which model, what to watch for, what counts as finished. Even for the job
your team runs every day, and so it comes out slightly different every time.

Give that bundle a name and put it in one file.

```json
// .deel/agents/reviewer.json
{
  "description": "read the diff and flag only what cannot be undone",
  "mode": "inspect",
  "tools": ["Read", "Grep", "Glob"],
  "maxSteps": 12,
  "prompt": "Start from what actually changed. Look at the irreversible things first. Do not comment on taste."
}
```

From then on the model only writes this:

```
Task({ agent: "reviewer", purpose: "sweep this diff", task: "…" })
```

The filename is the agent's name. Both `.deel/agents/` (this project) and
`~/.deel/agents/` (this machine) are read — on a name collision **the closer one wins.**
Claude Code's `.claude/agents/*.md` frontmatter is read as-is. `/agents` shows what is
defined.

| Field | Meaning |
|---|---|
| `description` `설명` | **Required.** This one line is all the parent model has to choose on |
| `mode` `모드` | `code`, `inspect`, `ask`… defaults to `code` |
| `model` `모델` | A profile name from your config — hand routine work to a smaller model |
| `tools` `도구` | What this subagent gets. **Only ever narrows** (below) |
| `prompt` `지침` | Goes **before** the task, not after |
| `maxSteps` `걸음` | Step ceiling (max 200) |

### Tools only ever narrow

Architect mode is a promise that no file will change, and people turn on `/architect`
trusting it. One line of `"tools": ["Write"]` in a definition file must not break that
promise — the screen would still say architect mode while files change.

So only the names that **the current mode already grants** survive. Anything else is
dropped, and **the screen says it was dropped** — silently removing it means someone
believes a tool is running, and when the subagent does not use it they suspect the model
rather than their own file.

Mode is bounded the same way: a subagent **can never be stronger than its parent.**
Called from a read-only mode, it drops to read-only even if the definition says `code`.

### What actually rides along on every request

The name and the one-line description, nothing else. The instructions are sent to the
subagent **after** it is chosen — putting them in the tool schema would ship every
unused agent's instructions on every request. Same arithmetic as loading skills in
stages.

Calling a name that does not exist **does not quietly fall back.** If the caller thinks
"the reviewer looked at this" while an ordinary subagent ran, nothing in the result
shows the difference. The available names are returned instead.

Turn it off with `DEEL_AGENTS=off`.

---

## Your own rules, enforced (hooks)

<sub>Where deel asks something it can never know about</sub>

Every company guards something different. One team must never let `git push` run,
another needs its in-house formatter after every edit, another has to check what you
typed for personal identifiers before it goes anywhere.

None of that can live inside this program. Put it in and every team forks, and from
that moment on our fixes stop reaching them. So we give you **the place**, and you
write what happens there.

This is a different axis from the permission rules. Those are a table of patterns, so
they only measure what we already know about. A hook can call any program at all —
your DLP scanner, your approval service, **something we will never know exists**.

```json
{
  "hooks": [
    { "때": "도구전", "도구": "Bash",       "명령": "python .deel/gate.py", "제한초": 10 },
    { "때": "도구후", "도구": "Write|Edit", "명령": "npx prettier --write --loglevel warn ." },
    { "때": "말전",                          "명령": "python .deel/dlp.py" }
  ]
}
```

Write it in `.deel/hooks.json` (this project) or `~/.deel/hooks.json` (this machine).
Claude Code's `hooks` shape (`PreToolUse`, `matcher`, `{"type":"command"}`) is accepted
as-is — telling someone who already has that file to rewrite it means they simply will
not use hooks.

| Event | When | Can it block? |
|---|---|---|
| `PreToolUse` `도구전` | Just before a tool runs — after the permission rules, before the approval prompt | **Yes** |
| `UserPromptSubmit` `말전` | **Before** what you typed enters the conversation | **Yes** |
| `PostToolUse` `도구후` | Right after a tool finishes; whatever it prints goes to the model | No |
| `Stop` `턴끝` | When a turn is finished | No |

There is one calling convention. **Everything is handed over on stdin as one line of
JSON** (`{"자리":"도구전","도구":"Bash","인자":{…}}`), and the answer is the **exit code**.

| Code | Meaning |
|---|---|
| `0` | Pass. What it printed goes to the screen and to the model |
| `2` | **Block.** What it printed becomes the reason, verbatim |
| anything else | The hook is broken — and on a blocking event that **blocks** (below) |

### A broken hook blocks

A gate with nobody at it is not a locked gate.

The common convention is "exit 2 blocks, every other failure passes through." Then one
typo in the hook file (`pythno check.py`) leaves that gate quietly open — while the
screen still says "3 hooks." Telling your security team a control is in place when it
silently is not is the worst outcome available here.

So **on a blocking event, a broken hook blocks.** It is the same judgement as never
counting an unmeasured thing as green. To let it through you have to **write it down**:
`"고장나면": "지나가기"` on that hook. Only what is written passes.

### This is somebody else's program too

| | |
|---|---|
| **Off by default** | Nothing runs until you write it in `hooks.json` yourself |
| **Trusted folders only** | The project file is read only in a folder you ran `deel trust` on. Without that, one `git clone` is enough to run someone else's commands on your machine |
| **Audited** | What ran, when, and what it blocked. **Including what it let through** — "never ran" and "ran and passed it" are different facts |
| **Model text never hits the command line** | Tool arguments and your prompt all go over stdin. Splicing them into a command line is the injection hole itself |
| **You can turn it off** | `deel --no-hooks` for one run, `DEEL_HOOKS=off` for good. A safety device with no visible off switch is not a safety device |
| **Outside the work scope** | Hooks do not respect our fence. The `/hooks` screen says so |
| **Still runs under `--offline`** | Unlike MCP. An MCP server is somebody else's program fetched from elsewhere; a hook is **a command you wrote in your own file** — blocking it while leaving the `Bash` tool alone would not be coherent |

A hook does not stand in for approval. Even when a hook passes, `strict` still asks —
permission is **the rules and the hook and you**.

`/hooks` shows what is armed; `deel doctor` shows why something is not running. The
most common reason is a folder that was never trusted, and that used to show up nowhere
at all, so both screens now say it.

---

## Inside your editor (ACP)

### Details — the places this breaks silently

This protocol fails quietly. The editor shows "the agent is not responding" and nothing
anywhere explains why. So these are nailed down by tests (`test/acp.test.js` spawns a real
process and talks over a real pipe).

| The place | Why it matters |
|---|---|
| **Nothing but ACP on stdout** | The spec says `MUST NOT`. deel has dozens of places that print to the screen; one of them firing in this mode breaks the pipe. Rather than guarding each call site, **the pipe itself is swapped out** — so code written later is safe without knowing about this. What gets printed is not dropped, it goes to stderr |
| **Korean split across chunk boundaries** | Pipes break on bytes, not characters. Decoding each chunk separately turns `안녕` into `안<?>하` — and **the JSON still parses**, so no error is raised. The characters are quietly mangled |
| **A request with `id: 0`** | ACP clients count from zero. Reading `if (msg.id)` treats the very first `initialize` as a notification and never answers — it hangs the moment it connects |
| **Cancellation reaching a running turn** | Cancellation always arrives while something is running; that is what cancellation is. Awaiting each incoming line in order means it **never arrives** |
| **When permission cannot be asked** | It is tempting to just run the tool — otherwise nothing works against a client that has not built the approval dialog yet. But that means "if I can't ask, I do as I please". **It does not** |
| **Not saying how we authenticate** | An empty `authMethods` in the `initialize` reply reads to the editor as "this agent needs no authentication". But deel can do nothing without a saved connection — so a first-time user opens a conversation, gets an error, and **cannot tell from the screen whether it is a setup problem or a bug.** The spec has a place for this (Terminal Auth). Nothing new had to be built; the `deel setup` that already existed just had to be **named** |
| **The number returned when there is no setup** | Declaring the method above and then answering `-32602` (invalid params) when the setup is missing leaves the editor unable to draw the "Authenticate" button — it just shows red text. The number the spec puts there is **`-32000` (AuthRequired)**. The user did not pass a bad argument; they **have not set up yet**, and the editor does different things about those two |

### Yesterday's conversation is still there

Close the editor, open it again, and **the conversation is still there.** What `--resume`
does in the terminal now works inside the editor — no re-explaining what was already
checked, or what you asked it not to touch.

Conversations live in the **same place** as the terminal's (`.deel/sessions/`), so a
session started in the editor can be picked up with `deel --resume <id>`, and the
other way round.

| What it gets right | Why |
|---|---|
| **Session id = file name** | The editor stores that id and hands it back **the next time it starts**. An id like `deel-1`, meaningful only inside one process, points at nothing once that process is gone |
| **Written at every step** | Writing once at the end of the turn means that if the editor closes after ten tool calls, all ten vanish. That is exactly the part worth restoring |
| **What is drawn ≠ what is sent** | If it died while a tool was running, the call is recorded with no result. Sent as-is, **the gateway answers 400** — it dies on the first message after restoring. So the model gets the repaired history, while **the person is shown that spot as "interrupted."** What you were in the middle of yesterday decides what you ask for today |
| **Pins come back too** | Otherwise "pinned text survives folding and summarising" becomes false the first time the editor is closed and reopened (`/pin`) |
| **The restored history reaches the model** | Redraw it on screen but not send it, and the person continues — "finish that thing from before" — while the model knows nothing. That is **worse than an empty conversation: the person is misled.** The test measures the body the gateway received, not the text on screen |

**What it does not do yet, stated plainly:**

| | |
|---|---|
| Image / audio attachments | Most local models cannot read them. Rather than dropping them silently, deel tells the model what it could not read |
| MCP servers passed in by the editor | Not launched. That would mean **deel spawning processes named in the editor's config**. "What does this tool launch?" is the first question in a corporate review, and "whatever the editor says" is not an acceptable answer. Only `.deel/mcp.json`, written by a person, is launched |

## Putting deel in a pipeline

### Pin the answer's shape — `deel run --output-schema`

`deel run` produces prose. That is fine for a person to read, but the moment
you pipe it somewhere the work starts.

```bash
deel run "pull the term and the termination clauses out of contract.hwpx" | ???
```

What goes after the pipe? The answer arrives in a different shape every time,
so you end up parsing it with `grep` or `sed`, and that parser breaks silently
the day the model words a sentence slightly differently. **Silently** is the
point — a script that gets an empty value raises nothing and passes the empty
value down the line.

Pin the shape up front and the whole problem goes away.

```bash
deel run --output-schema contract.schema.json "pull the term and termination clauses out of contract.hwpx" \
  | jq -r '.termination[]'
```

Standard output carries **that one JSON object** and nothing else. If the model
wraps it in a ```json fence or opens with "Sure, here you go", that is stripped
— and the fact that it was stripped is written to standard error, because
stripping it silently would take away your chance to fix the prompt.

### What happens when it does not match

| | |
|---|---|
| It asks once more | The mismatches are handed back verbatim and the model rewrites the answer. **Once** — repeating three or four times is forcing a model to do something it cannot, and you pay for every round trip |
| Still wrong: exit **7** | Letting a mis-shaped JSON out on standard output is the worst thing this feature could do. That is the exact situation it exists to remove |
| Standard output stays **empty** | In `cmd \| jq` the exit code of the first command is invisible. Handing over nothing is better — what actually arrived is already on standard error |
| A bad schema file means **no model call at all** | Saying "schema file not found" after a full run throws away everything the run cost. And it is usually a one-character typo |

With `--json`, the validated value also arrives in the result's `schema` field,
so you never have to re-parse `text`.

### What is not checked says so

This is not a full JSON Schema implementation. It checks `type`, `required`,
`properties`, `items`, `enum`, `minimum`, `pattern`, `anyOf` and the like; any
keyword outside that list is **passed over rather than pretended about** — and
the screen says which ones.

```
  ⚠ Some keywords in the schema are not checked: format · deprecated
```

Waving through a rule you do not implement is worse than not implementing it,
because the person walks away believing it was checked.

**`$ref` never reaches outside.** The spec allows a URL in `$ref` and most
validators will fetch it. We do not — one schema file must not become the way
around "there is exactly one outbound address, and a person chose it". A schema
pointing outward is **refused when it is read**, with a note to move the
definition inside the same file (`#/$defs/...`).

---

[← back to README](../../README.md)
