[← back to README](../../README.en.md)

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

**What it does not do yet, stated plainly:**

| | |
|---|---|
| `session/load` | Restoring a past conversation means replaying every message as an update. Half-built, the editor opens an empty conversation and the user assumes the history is gone. It reports **`loadSession: false`** |
| Image / audio attachments | Most local models cannot read them. Rather than dropping them silently, deel tells the model what it could not read |
| MCP servers passed in by the editor | Not launched. That would mean **deel spawning processes named in the editor's config**. "What does this tool launch?" is the first question in a corporate review, and "whatever the editor says" is not an acceptable answer. Only `.deel/mcp.json`, written by a person, is launched |

---

[← back to README](../../README.en.md)
