[← Back to README](../../README.md)

# Rolling it out at work

First-time users · one policy file · where requests go · measuring "done" · what the guards cannot do

---

One page, for people using deel for the first time and for whoever installs it for a team.
Each table links to the full document.

## First-time users

```bash
npm i -g deel-local-cli     # always installs the newest version on npm
deel setup                  # enter the corporate gateway address and key
deel doctor                 # checks each condition before connecting
deel                        # run it in the folder you work in
```

If something is blocked, send the `deel doctor` screen to your administrator **as it is**. It says
which line is blocked and why, and never prints a secret such as the key.

There are only three switches. You can ignore the rest.

| Switch | What it decides | How to change it |
|---|---|---|
| **Approval** | How much it asks before changing things — `auto` (hand-off: never asks; undo is the safety net) · `confirm` (irreversible commands only) · `strict` (every file change and command, **showing the change first**) | Shift+Tab · `/mode` |
| **Work mode** | What kind of job it is doing — the default, `종합` (auto), picks one from the request | `/work` |
| **Reach** | `이 안` (inside, the default) · `바깥` (online) · `봉인` (sealed — nothing leaves the company) | `--offline` · managed policy |

`auto` is the **hand-off** mode. Besides never asking about tools, when the model asks a question ("which
one should I do?") or answers "design it and build it" with a plan first, it **carries on by itself if nobody
answers within 60 seconds** — the question becomes "use your own judgement", and the plan goes ahead. If you
are there, just answer in the meantime. The wait is `askWait` in the config (seconds; `0` means never ask).
The asking modes (`confirm`, `strict`) wait with no limit — waiting for an answer is what you picked them for.

If an edit went wrong, `/undo` rolls back one turn at a time. `/diff` shows what changed in this
conversation, and `/status` shows where it is connected and what is in force.

## Administrators — one policy file

Put it where users cannot edit it: `%ProgramData%\deel\policy.json` on Windows,
`/etc/deel/policy.json` on macOS and Linux.

```json
{
  "baseUrl": "https://ai-gw.example.corp/v1",
  "offline": true,
  "approval": "strict",
  "permissions": { "deny": ["WebFetch", "Bash(curl*)", "Bash(git push*)"] }
}
```

| Field | What this one line gets you |
|---|---|
| `baseUrl` | Connects to this gateway only |
| `offline` | Nothing goes outside the company (public addresses). The intranet still works |
| `approval` | **A person always sees the diff and decides** before a file changes or a command runs. `/mode`, Shift+Tab, `--yes` and "don't ask again" cannot undo it |
| `permissions.deny` | The listed tools and commands never run, even if a person allows them |

Policy beats config and cannot loosen it — it can switch things on but not off, and add denials but
not remove the user's own. To see whether it applies, look for the approval floor line in
`deel doctor`, or run `/mode`. Details: [Managed policy](config.md#managed-policy-what-it-sets).

## Where requests go

Only four paths cross the line — **the model gateway, web reading (WebFetch), plugin downloads and
MCP servers.** Source code and file contents go to exactly **one** of them, the model gateway.
Sealing (`offline`) locks the other three; MCP servers are not even started.

| | |
|---|---|
| **Behind the gateway** | deel sends to the one address in the profile. If that is the corporate gateway, whether the gateway serves an in-house model or forwards to an outside API is **the gateway's configuration**. deel cannot see past it — ask whoever runs the gateway |
| **The intranet** | 10.x, 172.16–31.x and 192.168.x count as "inside" even when sealed. The boundary is "nothing leaves the company", not "no network" |
| **What is recorded** | What was sent where is kept in `.deel/audit.jsonl` and `deel stats` |

## Completion check

You can stop taking the model's "done" at its word. Put one check command in the repository's
`.deel/config.json` or in this machine's config.

```json
{ "check": "npm test", "checkRounds": 3 }
```

When the model has changed something and tries to finish, deel runs that command **itself**. If it fails,
the output goes back to the model to keep fixing (3 rounds by default). If it still fails, the turn ends as
failed — `deel run` exits with **8**, so CI goes red. To use a different check just this once:
`deel run --check "npm run lint"`.

The check goes through **the same gates** as a command the model calls — managed deny rules, hooks,
approval (`strict` asks), and the dangerous-command guard. Being in the config is no reason to skip them.
A turn that changed nothing does not run it.

## Golden set

"How many of our tasks do this model and deel actually get done" cannot be measured with 10,000-odd checks.
Those measure whether the tools keep their promises; **whether real work gets done** has to be measured with
your own tasks.

```bash
deel eval --init        # creates five example tasks in golden/ — add your own next to them
deel eval               # runs each task in a temp folder and grades it
deel eval --repeat 3    # models answer the same prompt differently — run several times and read the rate
```

One task is one folder.

| Where | What |
|---|---|
| `task.json` | `prompt` · `check` (the grading command) · optionally `doneCheck` (the completion check above) · `timeout` (seconds) |
| `start/` | Starting files. Copied to a temp folder, and deel works there |
| `golden/` | Grading files. Added **after** deel has finished — the model never sees them |

Grading is the exit code of the check and nothing else. Results are kept in `golden/.results/`, and each
run is compared with the last one to point out **tasks that got worse**. Run it after switching models or
upgrading deel. Add `--online` for an outside gateway. `check` is a command a person wrote, so it runs
without the gates — read a task set someone else gave you before running it.

## What the guards do and do not do

No single layer is relied on. Each one has something it cannot stop, so they are stacked.

| Layer | What it does | What it cannot do |
|---|---|---|
| **Blocked commands** | Stops irreversible commands such as a disk format, a recursive delete or a force push | It is a **deny list**. Shapes the list does not know can get through; the ones found and closed so far are in the [release notes](releases.md) |
| **Policy deny rules** | Stops the tools and commands an administrator lists | Only the patterns written down |
| **Approval (`strict`)** | A person sees the diff and decides before anything changes | Only as good as the person reading it |
| **Undo** | Snapshot before every edit → `/undo` | Files only. What a command did outside (a push, a database, an email) cannot be undone |
| **Audit log** | Records everything it did | Does not stop anything — it is for looking back |

More in [Safety and corporate review](safety.md).
