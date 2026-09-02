[← back to README](../../README.md)

# Safety and corporate review

Undo, working scope, the audit log, the review package (SBOM, egress list)

---

## Safety

<sub>Files removed through Bash come back too · What it will not read</sub>

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

### Where the key lives

The gateway key sits in `profiles[].apiKey` inside `~/.deel/config.json` (or `DEEL_HOME`). It used
to sit there **in plain text**. Saving applied `chmod 600`, which does nothing on NTFS — so "locked
to your account" was not a true statement on Windows.

It is now handed to the machine's own keystore.

| OS | How | What it means |
|---|---|---|
| Windows | DPAPI `ProtectedData` (CurrentUser) | Only **this account on this machine** can unlock it. Copying the file elsewhere gets you nothing |
| macOS | Login keychain | Appears as `deel-gateway-key`; you can delete it from Keychain Access |
| Others | File permission `0600` | No keystore, so that is what it says. It does not pretend to be locked |

The file then holds only the locked form, `"apiKey": "dpapi:AQAAAN…"`. A config written by an older
version is migrated **once, on the next start**, and says so in one line — change someone's key file
silently and they will later open it and think their key is gone.

The key is **never put on a command line.** Locking and unlocking shells out to PowerShell or
`security`, and the value always goes over stdin: a command line is visible to other users of the
same machine through the process list, and it lands in shell history. Both directions carry base64
only, so no console encoding can corrupt the bytes.

Unlocking costs one PowerShell call (about 0.3–0.8 s) once per session; the result is held in memory
for the rest of the run. To keep the key out of the file entirely, use the `DEEL_API_KEY`
environment variable — it wins over the file. Where policy blocks the keystore, `DEEL_KEYSTORE=off`
turns it off and leaves file permissions as the only protection.

The current state is printed verbatim in the `열쇠 보관` line of `/status` and in the diagnostic report.

---

## Corporate review package

<sub>Diagnosing a corporate gateway</sub>

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

[← back to README](../../README.md)
