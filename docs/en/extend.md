[← back to README](../../README.md)

# Extending

Skills, plugins, tools from outside (MCP), inside your editor (ACP)

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

---

[← back to README](../../README.md)
