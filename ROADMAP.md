# deel — Gap Roadmap (prompt-style spec)

Baseline: **v1.5.8**, `npm test` = 3,869 checks passing on 76 files, 0 dependencies.
Audience: any coding agent (or person) picking up the next slice. Each item below is a
self-contained **prompt card** — goal, why now, scope, acceptance, proof — so it can be
handed over verbatim.

Ordering is by urgency: **Tier 0** breaks the core promise if missing, **Tier 4** is polish.

---

## 0. Load this before touching anything

**What deel is.** A coding-agent CLI for local models and private corporate gateways.
It exists because corporate security blocks unapproved software: zero npm dependencies,
no install scripts, exactly one network destination. Korean-first screen (`/lang en`
exists), Korean identifiers in source (house style — do not "fix" that).

**Locked decisions (never reopen):**

| Decision | Consequence for you |
|---|---|
| `dependencies: {}` forever | Node 20+ built-ins only. No polyfills, no vendored copies. |
| One door out: `src/backend/http.js` | Every outbound request passes `checkUrl()` in `src/safety/network.js`. `test/network.test.js` fails if anything else calls `fetch`. |
| Undo instead of approval prompts | Default mode is autonomous; snapshot before write, `/undo` rewinds files **and** conversation. |
| Tool names and argument names are identifiers | Never translate `목적`, `할일`, `번호`. Only descriptions (`src/tools/desc.en.js`). |
| Skills are discovered on the host, not bundled | 3-stage loading; hooks are deliberately excluded (import review). |
| Honesty over reassurance | What could not be verified is reported as such (`Verify`, `/evidence`, review sheet). Never invent a number. |
| Tests use a fake gateway on **port 0** | Never bind a fixed port. Never test against a real local model. |
| Prefix-cache order is pinned | Stable prompt parts first, per-turn parts (mode, pins) last. `test/cache.test.js` guards it. |
| Docs are paired | `docs/ko/*.md` ↔ `docs/en/*.md`; `npm run docs` checks links. README is the summary. |

**House rules for a slice:**

1. Red test first (`test/<name>.test.js`, registered in `test/run.mjs` — `no-bundle.test.js` fails otherwise). Strip ANSI before matching screen text. Never put the literal shape `N개 통과 · M개 실패` inside test data.
2. New `src/**/*.js` files go into the `check` script in `package.json`.
3. Run `npm test`, then `CI=true node test/run.mjs`, then once from PowerShell. All three must be green.
4. Screen strings go through `src/i18n/{ko,en}.js` (`말('key')`). Model-facing text has a `sayEn` twin.
5. Shell scripts (`.github/workflows`) use ASCII variable names; JS may use Korean identifiers.
6. Commit per slice, Korean narrative title (`feat: …` / `fix: …` prefix is fine), body explains *why*. No push, no version bump, no `npm publish` — those are the owner's.
7. Proof for the owner is **a screen or a number**, not "done".

---

## 1. Tier table (most urgent first)

| Tier | ID | Feature | Why now (evidence) | Size | Security trigger |
|---|---|---|---|---|---|
| **0** | T0-1 | Corporate proxy that actually works (`HTTPS_PROXY` / config) | Docs promise `HTTPS_PROXY`; measured on Node 24.19: `fetch` with `HTTP_PROXY` set went **direct** (proxy saw 0 requests). On a no-direct-egress network the gateway is unreachable with no hint. | L | network |
| **0** | T0-2 | Retry with backoff on 429 / 5xx / reset | Shared gateways rate-limit per user; `Task` fans out calls; today one 429 throws in `adapter.js` and ends the turn. | S | — |
| **1** | T1-1 | Windows shell awareness (Git Bash → cmd, model is told) | `Bash` tool runs `cmd.exe` on Windows and the prompt never says so; models emit `ls`/`cat`/`grep`/`rm` → each failure is a 20–40 s round trip on a local model. | M | command exec |
| **1** | T1-2 | `.gitignore`-aware walking (+ `.deelignore`) | Walker skips a fixed list only; Java/Python/monorepo junk (`out/`, `.gradle/`, `coverage/`, generated code) floods `Glob`/`Grep`/`Outline` on an 8k–32k window. | M | fs paths |
| **1** | T1-3 | `/commit` — message from the session's own diff and evidence | Work leaves the agent only through git; today the model has to type `git commit -m` through `Bash` with quoting hazards and no evidence trailer. | M | command exec |
| **1** | T1-4 | Gateway key at rest: DPAPI (Windows) / Keychain (macOS) | `chmod 600` is a no-op on NTFS; the key sits in plaintext under the roaming profile. First question a reviewer asks. | M | secrets |
| **2** | T2-1 | Anthropic Messages API shape (`/v1/messages`) | Claude via Bedrock/corporate passthrough is a common gateway; only OpenAI-compatible and Ollama shapes exist. | L | network |
| **2** | T2-2 | Azure OpenAI URL shape (`/openai/deployments/{d}/…?api-version=`) | `api-key` header is supported but the URL shape is not; Korean enterprises are Azure-heavy. | S | network |
| **2** | T2-3 | Vision input (`Read`/`@` on png·jpg·webp → image part) | "Here is the screenshot of the bug" is the most common non-text input; local VL models and gateway GPT-4o/Claude accept it. | M | — |
| **2** | T2-4 | Permission rules + managed policy file | Only three approval modes; no persistent allow/deny (`Bash(npm test*)`), no admin-locked gateway address / forced offline for rollout. | M | authz |
| **3** | T3-1 | PDF text extraction (zero-dep, honest about unreadable pages) | Spec documents are PDFs; hwpx/docx/pptx already read. | L | — |
| **3** | T3-2 | `/review` — the model reviews the session diff in a fresh context | Pairs with `/commit`; catches what the writer cannot see. | S | — |
| **3** | T3-3 | Use `rg` / `git grep` when installed (install nothing) | JS walker is slow on 50k+ files; `rg` is often already on dev PCs. | S | command exec |
| **3** | T3-4 | Surface gateway quota headers (`x-ratelimit-*`) in `/cost` and status | Users learn about quota only when 429 hits. | S | — |
| **4** | T4-1 | `deel completion <shell>` (bash/zsh/PowerShell) | Discoverability. | S | — |
| **4** | T4-2 | Queue a message while a turn runs (steering) | Local turns are slow; typing "also do X" should not require Ctrl+C. | M | — |
| **4** | T4-3 | Clipboard image paste (after T2-3) | Screenshot → Ctrl+V. | S | — |
| **4** | T4-4 | ACP `session/load` | Editors currently open an empty conversation on resume. | M | — |
| **4** | T4-5 | Screen languages ja / zh | Same mechanism as `en`; translation only. | S | — |

Size: S ≤ 1 day, M 1–3 days, L 3–5 days for one agent including tests and docs.

---

## 2. Build order — thin vertical slices

Each slice is end-to-end (test → code → screen → docs → review sheet where relevant) and
ships as one commit. Order chosen so that each slice is independently valuable:

1. **T0-2 retry/backoff** — smallest, unblocks stability for every later test run against a gateway.
2. **T0-1 proxy** — the biggest correctness gap against the project's own docs.
3. **T1-1 shell awareness** — largest daily-productivity gain on the target platform.
4. **T1-2 .gitignore walking** — context hygiene for real repos.
5. **T1-3 `/commit`** — closes the loop from edit to repository.
6. **T1-4 key at rest** — review-sheet line reviewers ask for.
7. Tier 2 onward — separate spec pass; T2-1 and T2-2 share the adapter and should be planned together.

Gate 1 (slice plan) is this document. Gate 2 (commit) is per slice: diff summary + message shown, then commit locally.

---

## 3. Prompt cards

### T0-1 — Corporate proxy that actually works

**Goal.** A PC that can reach the gateway only through an HTTP proxy uses deel with
`HTTPS_PROXY` (or `proxy` in config) on every supported Node (≥ 20), and the screen says
which proxy is in the path.

**Why now.** `docs/*/config.md` and the README troubleshooting table say "behind a proxy:
set `HTTPS_PROXY`". Node's built-in `fetch` ignores proxy env vars unless the process was
started with `NODE_USE_ENV_PROXY=1` (Node ≥ 24 only). Measured here: with `HTTP_PROXY` set,
the request went straight to the target; the proxy saw nothing. A documented escape hatch
that does not work is worse than none.

**Scope — in.**
- Read `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` (upper and lower case) and `NO_PROXY`
  (`*`, `.corp.com`, `corp.com`, `host`, `host:port`, IPv4). Config key `proxy`
  (`"none"` or a URL) overrides env. **Loopback is always direct** — a machine-wide proxy
  env must not break local Ollama.
- `https://` targets: `CONNECT host:port` then TLS over the tunnel. `http://` targets:
  absolute-URI request to the proxy. `Proxy-Authorization: Basic` from the URL userinfo.
- Same result shape as today's `req()` (`ok/status/json/text/ms/headers`; for streams a
  body with `getReader()`), so `adapter.js` does not change. Timeout and Ctrl+C abort work.
- `NODE_EXTRA_CA_CERTS` keeps working (it is a startup env — the tunnel path uses Node's default trust store).
- Proxy origin printed at startup (`보냄 … (프록시 10.1.2.3:8080 경유)`), in `/status`, in
  `deel diagnose`, and in the review sheet / `심사명세.json` egress lanes ("[A] may pass
  through the proxy named in `HTTPS_PROXY`; the target is still the one allowed origin").
- `test/network.test.js`: extend the low-level-socket scan to **every** file under `src/`,
  allowing `node:http`/`node:https`/`node:tls` only in `src/backend/http.js` (the door) and
  `node:http` in `src/preview/serve.js`. Review-sheet scan (`src/pack/selfpack.js`) must
  count `http.request(` / `https.request(` / `tls.connect(` as network sites.

**Scope — out.** PAC files, Windows registry/IE proxy settings, NTLM/Kerberos proxy auth
(on `407` with `Proxy-Authenticate: NTLM|Negotiate`, say so in one line). Document these
as not supported.

**Acceptance (all as checks in `test/proxy.test.js`).**
1. Selection table: env combos, case, `NO_PROXY` forms, loopback bypass, config override, `"none"`.
2. A real local proxy on port 0 receives `POST http://<target>/v1/chat/completions` (absolute URI) and the target sees the body unchanged; streaming SSE flows through it.
3. An `https://` target behind `CONNECT`: the proxy sees `CONNECT host:port`, the target sees the request. Cert is minted in-test (DER built by hand, RSA-SHA256), trusted via `NODE_EXTRA_CA_CERTS` in a child process.
4. Proxy down / `407` / non-2xx `CONNECT` → one readable error that names the proxy.
5. `checkUrl` still gates the **target**; an unlisted target never reaches the proxy either.
6. Ctrl+C while the tunnel is being set up returns as `Aborted` within 100 ms.
7. `--offline` behavior is unchanged.
8. The docs sentence about `HTTPS_PROXY` is now true; add `NO_PROXY` and `proxy` config to `docs/{ko,en}/config.md`.

**Proof to show.** The startup header line with the proxy, `/status` line, the proxy test's
"proxy saw N requests" numbers, and the check count delta.

**Touchpoints.** `src/backend/http.js` (transport), new `src/backend/proxy.js` (pure
selection logic, no sockets), `src/safety/network.js` (record proxy origin for reporting),
`src/ui/status.js` (header), `src/commands.js` (`/status`), `src/backend/probe.js`
(diagnose report), `src/pack/selfpack.js` (scan + lanes), `test/network.test.js`,
`test/proxy.test.js`, `test/mkcert.mjs`, docs.

---

### T0-2 — Retry with backoff on 429 / 5xx / connection reset

**Goal.** A transient gateway failure costs seconds, not the turn.

**Why now.** `adapter.chat()` / `chatStream()` throw on any non-2xx; `loop.js` retries only
for truncation and empty replies. Corporate gateways return `429` (per-user quota) and
`502/503` (upstream restarts) routinely, and `Task` fan-out raises the odds.

**Policy.**
- Retry on HTTP `408 429 500 502 503 504 529` and on connection errors **before any body
  byte** (`ECONNRESET`, `EPIPE`, `fetch failed`). Never retry after streamed content has
  been shown. Never retry on `400/401/403/404`.
- Max 3 retries. Wait = `Retry-After` (seconds or HTTP date, capped at 60 s) else 1 s, 2 s,
  4 s, each with ≤ 30 % jitter. Ctrl+C during the wait aborts immediately.
- Screen: `↻ 서버가 잠시 막았습니다 (429) — 2초 뒤 다시 (1/3)`; English twin. `deel run`
  prints the same in its side log; `--json` gets `retries`. ACP gets a one-line note.
- Applies everywhere the adapter is used (REPL, `deel run`, ACP, `Task`, `/consult`, `diagnose`).

**Acceptance (`test/retry.test.js`, fake gateway on port 0).**
1. `429` then `200` → turn completes; one `backoff` event; `session.usage.retries === 1`.
2. `503` with `Retry-After: 1` → waited ≥ 1 s (measured), then completed.
3. Four `429` in a row → error text contains `429` and the count of attempts; the turn ends cleanly (conversation still valid).
4. Socket destroyed before headers → retried once and completed.
5. Reset **after** 30 streamed characters → not retried; the partial text is kept (existing salvage path).
6. Abort during the wait → `aborted` within 100 ms.
7. Non-streaming `chat()` path retries too (`conn.streaming=false`).
8. `400` is not retried (still one call).

**Proof.** The `↻` line on screen from the fake gateway demo, and the eight checks.

**Touchpoints.** `src/backend/adapter.js` (retry wrapper around `req`), `src/backend/http.js`
(expose `Retry-After`), `src/agent/loop.js` (yield `backoff`), `src/repl.js`,
`src/oneshot.js`, `src/acp/serve.js` (render), `src/agent/session.js` (`usage.retries`),
`src/i18n/*`, docs (`tuning.md`: one paragraph).

---

### T1-1 — Windows shell awareness

**Goal.** On Windows, `Bash` runs in the shell the model is most likely to write for, and
the model is told which shell it is running in — one stable line in the prompt.

**Why now.** `src/tools/index.js` and `src/tools/jobs.js` hard-code `cmd.exe` on Windows and
the system prompt never mentions the OS or shell. Local models emit `ls`, `cat`, `grep`,
`rm -rf`, `export`, `$(…)`; in cmd each is a failed round trip. Git for Windows is on most
developer PCs (git itself is approved software).

**Design.**
- New `src/tools/shell.js`: one `고르기()` used by **both** `Bash` and `Jobs`. Order on
  Windows: `DEEL_SHELL` env / config `shell` (`auto|bash|powershell|cmd`) → Git Bash
  (`%ProgramFiles%\Git\bin\bash.exe`, `usr\bin\bash.exe`, or a `bash.exe` on PATH that is
  **not** `System32\bash.exe` — that one launches WSL) → `cmd.exe`. Non-Windows: `/bin/sh`
  as today. PowerShell only when chosen explicitly (Windows PowerShell 5.1 rejects `&&`).
- Prompt gets one line in the **stable** front section, e.g.
  `Shell: bash (Git for Windows) on Windows — Unix commands work; Windows tools are on PATH too.`
  or for cmd: `Shell: cmd.exe on Windows — no ls/cat/grep; use dir/type/findstr, or powershell -NoProfile -Command "…".`
  Korean and English twins. `test/cache.test.js` must stay green (line is constant within a session).
- `/status` shows the shell and its path. Startup header: nothing (keep it short).
- Scope guard: `/c/Users/...` MSYS-style absolute paths must resolve inside the root when
  they point there; existing `checkPaths` behavior for Windows paths unchanged.
- Blocked-command list stays shell-agnostic; add the Git-Bash spellings that were not
  reachable before only if missing (`rm -rf ~`, `rm -rf /c`).
- Output decoding unchanged (UTF-8 if valid, else console codepage).

**Acceptance (`test/shell.test.js`).**
1. Selection: fake PATH/dirs → expected pick; `System32\bash.exe` alone is skipped; `DEEL_SHELL=cmd` wins; unknown value → `auto` with a warning.
2. Real run on this PC: with Git Bash, `printf '%s' "$0"` works; with `DEEL_SHELL=cmd`, `echo %COMSPEC%` works; with `powershell`, `$PSVersionTable.PSVersion.Major` prints a number. Skip with a visible ⚠ where a shell is absent (CI Linux/mac).
3. `Bash` and `Jobs` pick the same shell (assert same object).
4. Prompt contains exactly one `Shell:` line, before the mode section.
5. `/status` prints the shell line.
6. Undo snapshot for `mv a b` still taken under bash.

**Proof.** A before/after transcript on this PC: `ls src | head -3` under cmd (fails) vs under bash (works), plus the prompt line.

**Touchpoints.** `src/tools/shell.js` (new), `src/tools/index.js`, `src/tools/jobs.js`,
`src/agent/session.js` (prompt line), `src/commands.js` (`/status`), `src/config.js`
(`shell` key), `src/safety/guard.js` (MSYS paths), i18n, `docs/{ko,en}/config.md`,
`docs/{ko,en}/tools.md`.

---

### T1-2 — `.gitignore`-aware walking

**Goal.** `Glob`, `Grep`, `Outline`, `Verify` and the `@dir` listing skip what git skips,
and say how much they skipped.

**Why now.** `fsutil.walk()` skips a fixed set (`node_modules`, `dist`, `.venv`, …). Real
repos add `out/`, `.gradle/`, `coverage/`, `*.min.js`, generated code, data dumps. On a
32k window one `Grep` over a Spring project can spend the whole budget on build output.

**Design.**
- New `src/tools/ignore.js`: parser + matcher for the gitignore subset — blank/comment,
  `!` negation, trailing `/` (dir only), leading `/` (anchored), `*`, `**`, `?`, no-slash
  patterns match at any depth by basename, patterns with a slash are anchored to the file
  that contains them. Nested `.gitignore` files apply to their subtree. Root `.deelignore`
  is read with the same syntax, after `.gitignore`.
- `walk(root, { ignore = true })`. `SKIP_DIRS` remains the floor (always skipped).
  The result carries a non-enumerable `건너뜀` count. Callers append one line when > 0:
  `(.gitignore 로 N개 건너뜀 — 경로를 직접 주면 Read 된다)`.
- `Read`/`Edit` on an explicit ignored path still work (only listings are filtered).
- Windows separators normalised before matching. Case-insensitive on Windows, as `globToRegex` already is.

**Acceptance (`test/ignore.test.js`).**
1. Semantics table (≥ 20 rows) against expected git behaviour, including negation re-include, anchored vs unanchored, `**/`, dir-only, trailing spaces, CRLF files.
2. Nested `.gitignore` applies only below its folder.
3. `Glob('**/*.js')` in a fixture with `build/` ignored returns none of it and reports the count.
4. `Grep` and `Outline` share the behaviour (same walker); `Read('build/x.js')` still reads.
5. No `.gitignore` → identical results to today (regression).
6. 5,000-file fixture walks in < 150 ms with ignore on (measured, printed).

**Proof.** The count line on screen and the timing number.

**Touchpoints.** `src/tools/ignore.js` (new), `src/tools/fsutil.js`, `src/tools/index.js`
(Glob/Grep result line), `src/tools/outline.js`, `src/tools/verify.js`,
`src/agent/mention.js` (`@dir`), `docs/{ko,en}/tools.md`.

---

### T1-3 — `/commit`

**Goal.** One command turns this session's changes into a well-formed commit whose message
comes from the actual diff and the evidence deel already keeps.

**Why now.** `/evidence` and `/export` already know what changed and what was verified;
the commit is where that knowledge should land. Going through `Bash git commit -m` loses
it and hits quoting hazards on Windows.

**Design.**
- `/commit` — stages the files this session changed (`session.changes`) and commits.
  `/commit 전부` — all changes in the working tree. `/commit 미리보기` — message only.
  `/commit <title>` — use the given title, generate only the body. Never pushes.
- Message: the model is asked once, in a separate context, with the staged diff (capped by
  the window budget), the `/evidence` summary (verified / unverified), and the last 10 commit
  subjects so the repo's own style is mirrored (conventional or not). Output via JSON schema
  `{제목, 본문}`; title ≤ 72 chars. A trailer `Generated-by: deel <version> · <model>` is
  appended; a line `검증: N건 확인 · M건 미확인` goes in the body when M > 0.
- Message is written through `git commit -F <tmpfile>` (no `-m` quoting). `git` must be on
  PATH; otherwise one clear line. Not a repo → one clear line. Nothing staged → say so.
- Screen shows the message and `git status --short` before running; in `strict` mode ask.
- Audit entry `commit` with hash, files, title.

**Acceptance (`test/commit.test.js`, temp git repo, fake gateway for the message).**
1. Only the session's files are staged; an unrelated dirty file stays unstaged.
2. Title/body from the fake model land in `git log -1`; trailer present.
3. `미리보기` commits nothing. `전부` stages everything. Given title is used verbatim.
4. No git / not a repo / nothing to commit → readable lines, no throw.
5. Title longer than 72 chars from the model is trimmed and the body keeps the rest.
6. Skip with ⚠ if `git` is absent on the test machine.

**Proof.** `git log -1` after a demo turn and the `/commit` screen.

**Touchpoints.** `src/agent/commit.js` (new), `src/commands.js`, `src/agent/evidence.js`
(reuse), `src/safety/audit.js`, i18n, `README*` command table, `docs/{ko,en}/interface.md`.

---

### T1-4 — Gateway key at rest

**Goal.** The saved gateway key is unreadable to anyone but this Windows/macOS user
account, and the review sheet says so.

**Why now.** `config.save()` does `chmod 600`, which does nothing on NTFS. Reviewers ask
"where is the key stored and who can read it". `DEEL_API_KEY` exists but most people save
the key.

**Design.**
- New `src/safety/keystore.js`: `잠그기(text) → "dpapi:<b64>" | "keychain:<label>"`,
  `풀기(tag) → text`. Windows: `powershell.exe -NoProfile -NonInteractive -EncodedCommand`
  calling `ProtectedData.Protect/Unprotect` (`CurrentUser`), key passed via **stdin**, never
  argv (same rule as the Excel password). macOS: `security add-generic-password` /
  `find-generic-password -w`. Linux: unchanged file with `0600` (report as such).
- `config.load()` transparently decrypts; result cached per process. On first load of a
  plaintext key where a keystore works, re-save encrypted and print one line
  `🔒 게이트웨이 키를 이 PC 계정에서만 풀리게 잠갔습니다 (DPAPI)`. If the keystore fails
  (policy blocks PowerShell), keep plaintext and say so — never silently.
- `deel audit` / review sheet: "Key at rest: DPAPI (Windows) · Keychain (macOS) · file 0600 (Linux)".
- `resolveKey` precedence unchanged (env wins).

**Acceptance (`test/keystore.test.js`).**
1. Round trip on Windows through real DPAPI; tag format; wrong tag → readable error. Skip with ⚠ elsewhere.
2. Migration: plaintext config → after `load()` the file no longer contains the key text; `resolveKey` still returns it.
3. The PowerShell command line never contains the key (assert on the spawned args).
4. `DEEL_API_KEY` still beats the file.
5. Review sheet contains the key-at-rest line.

**Proof.** `type %USERPROFILE%\.deel\config.json` showing `dpapi:` and `/status` still connected.

**Touchpoints.** `src/safety/keystore.js` (new), `src/config.js`, `src/setup.js`,
`src/pack/selfpack.js`, i18n, `docs/{ko,en}/safety.md`, `docs/{ko,en}/config.md`.

---

### T2-1 — Anthropic Messages API shape

**Goal.** `deel setup` against a gateway that speaks `/v1/messages` works like the other two shapes.

**Scope.** Detect by probing `POST /v1/messages` with `anthropic-version`; map system
prompt → `system`, tools → `tools[].input_schema`, tool results → `tool_result` blocks,
streaming events (`content_block_delta`, `message_delta` usage), `thinking` blocks →
`thinking` events, `max_tokens` required. Reasoning control via `thinking: {type:'enabled', budget_tokens}`.
Keep everything in `src/backend/adapter.js` (one place absorbs shape differences).

**Acceptance.** Fake Anthropic-shaped server on port 0 drives the full loop (read → edit →
answer), streaming and non-streaming, tool pairing after `/undo`, context-length error
learned from the body. `deel diagnose` verdict `ready`.

---

### T2-2 — Azure OpenAI URL shape

**Goal.** `https://<res>.openai.azure.com/openai/deployments/<dep>` with `?api-version=…` works.

**Scope.** `candidates()` recognises the deployment path; the query string survives
`endpoint()`; model name = deployment name; `api-key` header preferred. Probe `GET
/openai/deployments?api-version=` for the model list when allowed.

**Acceptance.** Fake server asserts the exact path and query; `deel setup` completes with
the address pasted as Azure shows it.

---

### T2-3 — Vision input

**Goal.** `Read` on `.png/.jpg/.jpeg/.gif/.webp` and `@shot.png` send the image to a model that accepts images.

**Scope.** Probe once per model (1×1 PNG); remember `vision: true|false` in the profile.
OpenAI shape → `image_url` data URI part; Ollama → `images: [b64]`. Size cap by window
(default 4 MB, downscale not attempted — say "too large"). Non-vision model → one honest
line instead of a base64 dump. Tool description mentions images only when `vision` is true.

**Acceptance.** Fake gateway receives the image part; non-vision path never sends bytes;
`@` attach shows `◧ attached shot.png (image · 120KB)`.

---

### T2-4 — Permission rules and managed policy

**Goal.** Teams can say "always allow `npm test`, never allow `curl`", and IT can lock the
gateway address for a rollout.

**Scope.** `permissions.allow / deny` arrays in `.deel/config.json` with the
`Tool(pattern)` syntax; ACP's `allow_always` persists there. Managed policy file
(`DEEL_POLICY` or `%ProgramData%\deel\policy.json` / `/etc/deel/policy.json`) read-only
to the user, can pin `baseUrl`, force `offline`, add `deny`. `/mode` shows the policy source.

**Acceptance.** Deny beats allow beats mode; policy beats config; screen names the source of every refusal.

---

### T3-1 — PDF text extraction

Zero-dep parser: xref/xref-stream, object streams, `FlateDecode`, text operators
(`Tj/TJ/'/"`), `ToUnicode` CMaps (Korean PDFs are Identity-H), page order, honest
`N pages unreadable (scanned/encrypted)`. Read-only, same as the other document formats.

### T3-2 — `/review`

Runs the model over the session diff (or `git diff`) in a fresh `Task` context with a fixed
checklist; output is findings with `path:line`. Never edits. Pairs with `/commit`.

### T3-3 — `rg` / `git grep` when present

If `rg` (or `git grep` inside a repo) is on PATH, `Grep`/`Glob` use it and say which engine
ran; otherwise the JS walker. Install nothing.

### T3-4 — Quota headers

Parse `x-ratelimit-remaining-requests/tokens` and `retry-after` from gateway responses;
show in `/cost` and, when low, in the status line.

### T4 — Polish

`deel completion <shell>`; queued input while a turn runs; clipboard image paste; ACP
`session/load`; ja/zh screen languages.

---

## 4. Evaluation rubric (used by the evaluator agent per slice)

Weighted 1–10 per axis, pass ≥ 7.0, plateau rule after 3 iterations without improvement.

| Axis | Weight | 9–10 looks like |
|---|---|---|
| Correctness under the constraints | 0.35 | Every acceptance check passes; no new dependency; the one-door and prefix-cache tests untouched or strengthened. |
| Honesty of the screen | 0.25 | Every new line on screen is a real number or a real state; nothing invented; failures name their cause. |
| Test quality | 0.20 | Tests would fail on the old code; fake gateway on port 0; ANSI stripped; skips are visible ⚠, not silent. |
| House style | 0.10 | Korean identifiers/comments explaining *why*; i18n twins; docs paired ko/en; `check` script updated. |
| Blast radius | 0.10 | Diff touches only the listed touchpoints; security-trigger files reviewed; no behaviour change for users who do not opt in. |

---

## 5. Considered and rejected

| Idea | Why not |
|---|---|
| Hooks (pre/post tool scripts) | Executable scripts fail import review; widens the blast radius of autonomy. |
| Agent swarms / parallel sub-agents | Doubles gateway quota use; `Task` already isolates context. |
| Web search tool | Blocked on corporate networks; intranet search belongs in MCP. |
| OS sandbox for `Bash` | No zero-dependency way on Windows; scope guard + undo is the model. |
| VS Code extension | A separate deliverable with its own import review; terminal + ACP cover editors today. |
| Auto-update / telemetry | One network destination is the promise. `deel pack` is the distribution path. |
| Translating tool or argument names | They are identifiers; renaming stops the tool from being called. |
