# Plan: Remote-model wire compatibility, prompt-cache survival, session identity, rate-limit resilience

**Target release:** deel v1.12.0
**Baseline:** v1.10.0 (f17088b)
**Owner decision:** execute stages 0-5 end to end, then tag and publish.

---

## 0. Read this before touching anything

deel is a coding-agent CLI for local models and private corporate gateways.
Locked constraints that this work must not break:

| Constraint | Consequence |
|---|---|
| `dependencies: {}` forever | Node 20+ built-ins only. |
| One door out: `src/backend/http.js` | Every outbound request passes `checkUrl()`. `test/network.test.js` fails otherwise. |
| Korean identifiers in source | House style. Do not "fix" it. New code follows it. |
| Screen strings go through `src/i18n/{ko,en,ja,zh}.js` | Model-facing text needs an English twin. |
| Tests use a fake gateway on port 0 | Never bind a fixed port, never test against a real model. |
| Prefix-cache order is pinned | Stable prompt parts first, per-turn parts last. `test/cache.test.js` guards it. |
| New `src/**/*.js` goes in the `check` script | `package.json`. |
| New `test/*.test.js` goes in `test/run.mjs` | `no-bundle.test.js` fails otherwise. |
| Never guess a wire field | An invented request field becomes a 400 that looks like a bad key. Guess once, learn from the rejection, remember. |

**Security identity to preserve.** Broadening compatibility must not widen the
attack surface: no new dependency, no second network door, no telemetry, no key
material in new fields, no silent egress. Every new request field is either
(a) documented for that vendor, or (b) sent once and dropped permanently on
rejection. The session identifier is derived from a local id and must never
carry a path, a hostname, or the user's key.

---

## 1. Problem statement

Observed on AWS Bedrock with Claude Opus 5, `/think max`, `/effort even`:
ten consecutive requests, total tokens climbing 19,654 to 60,267, the cache
column pinned near 5.9K the whole way, then "call limit exceeded".

Root findings, confirmed by reading the source:

| ID | Finding | Location |
|---|---|---|
| A | deel never marks anything for caching. `cache_control` appears nowhere in `src/`. Only the server's own automatic prefix caching is in play, and that can reach no further than the static head of the prompt. | `src/backend/adapter.js` `buildBody`, `anthropic몸` |
| B | deel cannot see caching. `extractMessage` and `absorb` read only input and output counts for all three wire shapes. No `cache_read_input_tokens`, no `prompt_tokens_details.cached_tokens`, no `cache_write_tokens`. | `src/backend/adapter.js` |
| C | On the OpenAI shape, `max` effort is flattened to `high` before it leaves. The screen says max, the wire says high. Claude's `xhigh` and `max` rungs are unreachable. | `src/backend/adapter.js` `전선눈금` |
| D | On the Anthropic shape, thinking is always sent as `{type:'enabled', budget_tokens}`. Opus 5, Opus 4.7/4.8 and Fable 5 reject that with a 400. | `src/backend/adapter.js` `생각예산` |
| E | No session identifier is sent in any shape, so a gateway opens a new session per request. | `src/backend/http.js` `headersFor` |
| F | Old tool results are folded one at a time, every step, rewriting a position in the middle of the prompt. Whatever prefix cache exists is invalidated on each step. | `src/agent/compact.js` `foldToolResults` |
| G | After folding, the file memory still claims the file content is in the conversation, so a re-read returns "same as before" and the model reads the file again. | `src/agent/compact.js`, `src/agent/filemem.js` |
| H | 429 throws after three attempts and kills the turn. Quota headers are read but only displayed, never used to pace requests. | `src/backend/retry.js`, `src/backend/quota.js` |
| I | Bedrock is reached only through `chat/completions`. The `bedrock-mantle` host serves the Anthropic Messages API with a bearer API key, where explicit cache breakpoints and adaptive thinking are first-class. `벤더()` does not recognise that host. | `src/providers/bedrock.js`, `src/backend/toolfit.js` |

**Scope of the defect.** A is not Bedrock-specific. It is present on every remote
shape. What differs is the symptom. Bedrock and OpenAI perform automatic prefix
caching, so a static head is cached and the growing conversation is not. The
Anthropic direct API performs no automatic caching, so an unmarked request
caches nothing at all. Local runtimes keep their own KV prefix cache and are
already served by the pinned prompt order.

---

## 2. Design: the wire card

The fix must not be a hardcoded model table. Model tables rot, and this project
already has a three-step pattern for exactly this problem: guess from what is
visible, learn from the server's own rejection, persist what was learned
(`src/backend/learn.js`, `src/agent/card.js`, `src/agent/evolve.js`).

Add `src/backend/wire.js`. A wire card describes what one model on one host
actually accepts. It is decided once per session and held constant, so the
request prefix does not move underneath the cache.

| Field | Values | First guess | Learned from |
|---|---|---|---|
| `생각형식` thinking format | `adaptive` / `budget` / `effort` / `boolean` / `none` | Claude 4.6 and newer to `adaptive`; older Claude to `budget`; GPT-5 and o-series to `effort`; Ollama to `boolean`; unknown to `none` | 400 naming `budget_tokens`, `thinking`, or `reasoning_effort` |
| `눈금` effort rungs | vendor-specific list | Claude `low` through `max` including `xhigh`; OpenAI `minimal` through `high`; Gemini `none` through `high` | 400 naming an invalid effort value |
| `캐시` cache marking | `explicit` / `key` / `auto` / `none` | Anthropic shape to `explicit`; OpenAI direct to `key`; known auto-caching host to `auto`; unknown to `none` | 400 naming `cache_control` or `prompt_cache_key` |
| `세션자리` session id slot | `user` / `metadata` / none, plus an optional header | OpenAI shape to `user`; Anthropic shape to `metadata`; a header only when configured | 400 naming the field |
| `usage이름` | per shape | shape default | the first response that carries one |

Persisted per model in the existing `배운것.json` home file, beside the existing
per-model habit counters. A different host gets a different slot.

`/status` and `/think` print the active card, so what the screen says and what
the wire carries are the same thing.

---

## 3. Design: effort that follows the request

`/think max` currently means "send max on every call of every turn". That is
expensive on trivial turns, and it is not what a person means by max.

New behaviour: the level the user sets is a **ceiling**. Each turn picks a level
up to that ceiling from the shape of the request. Greetings and one-line
acknowledgements run low. Real work runs at the ceiling. A turn that is stuck
after a tool failure may step up, still within the ceiling.

One guard rail matters more than the saving. Changing effort between requests
invalidates the message cache on every current model. So the level is chosen
**once per turn**, held for every step inside that turn, and once the
conversation holds a meaningful cached prefix the level stops moving unless the
user changes it. Protecting a 60K cached prefix is worth more than saving a few
thousand output tokens on one short turn.

Internal rungs become `off, low, medium, high, xhigh, max`, so Claude's real
range is reachable. Vendors without a rung clamp to their nearest.

---

## 4. Stages

### Stage 0 - Measurement (gate)

Nothing else can be judged without it.

1. Read cache usage for all three shapes; accumulate `cacheRead` and `cacheWrite` on the session.
2. Send `stream_options.include_usage` on the OpenAI shape for vendors known to accept it, so streaming turns report usage at all.
3. `DEEL_TRACE_BODY=<dir>` dumps request bodies with the key redacted, for prefix diffing.
4. Show read and write separately in `/cost`, the status line, and `deel run --json`.

### Stage 1 - Keep the conversation in cache

1. Split the system prompt into a stable part and a per-turn part; expose both.
2. Anthropic shape: system becomes text blocks with a breakpoint at the end of the stable part, which covers tools too, plus a moving breakpoint on the last message block, plus one anchor further back for long tool runs.
3. OpenAI shape: send `prompt_cache_key` only where it is documented. Do not inject unknown fields into a gateway; rely on the server's automatic caching plus prefix stability.
4. Freeze the wire parameters for the life of the session: thinking format, effort rung, tool order, output ceiling. A truncation retry is the one allowed exception.
5. Fold in batches, not one item per step, and only when the reclaim is worth breaking the prefix for.
6. Drop folded files from the file memory, so a re-read comes back whole.

### Stage 2 - Session identity and rate limits

1. Send a stable session id in the slot the wire card names, plus an optional configured header. Derived from the local session id; never a path, host, or key.
2. Pace before sending: when the quota headers say the next request will be refused, wait for the reset instead of spending an attempt.
3. Treat 429 as "wait", not "fail": honour `Retry-After` up to a total ceiling instead of dying after three tries.

### Stage 3 - Wire card

1. `src/backend/wire.js`, its persistence, and the `/status` and `/think` display.
2. Anthropic shape: adaptive thinking plus `output_config.effort` where the card says so, budget otherwise.
3. OpenAI shape: send the vendor's own rung instead of flattening everything to `high`.
4. `bedrock-mantle` host support and vendor recognition.
5. `refusal` stop reason surfaced as a sentence; context window read from the models endpoint.

### Stage 4 - Effort that follows the request

1. Per-turn level selection under the user's ceiling, pinned once the cache is worth protecting.
2. `/think auto` toggles it. `/think` shows the ceiling, the level chosen, and the wire rung.
3. `/cost` reports thinking tokens separately, so the price of a high ceiling is visible.

### Stage 5 - Documentation, tests, release

Paired `docs/ko` and `docs/en`, README, ROADMAP. Full suite three ways
(`npm test`, `CI=true node test/run.mjs`, once from PowerShell), then version
1.12.0, tag, publish.

---

## 4b. What was built, and what was not

All six stages shipped. Three decisions moved during the build, each because
measurement disagreed with the plan.

| Planned | Shipped | Why it moved |
|---|---|---|
| `stream_options.include_usage` only for known-good vendors | Same, but gated on the wire card | The gate is now the card rather than a hardcoded list, so an unknown gateway gets nothing extra. |
| Both send paths pass the same arguments to `buildBody` | One shared builder that both paths call | "Write the same thing twice" is a shape where one copy eventually gets fixed alone. Attaching the wire card nearly did exactly that. The source-scan test now checks there is only one place a body can be built. |
| Session name: strip unsafe characters | Replace the whole string with a fingerprint unless it is already safe | Stripping does not look at what survives. A Windows desktop path came out as `deel-CUsersyunseokDesktop` - only the Korean fell off. The person's name and the folder names went out intact. |
| Send the session name on every OpenAI-shaped request | Send it only where the vendor documents a slot | Checked the Bedrock docs while writing this: `user` is not listed for its OpenAI-compatible endpoint, and even if accepted there is nothing to gain - that endpoint caches the head server-side rather than grouping by name. Narrowing wrongly costs nothing measurable; widening wrongly costs the turn. |
| Effort rungs follow the vendor | Rungs follow the vendor **and the body's protocol** | Same check: `xhigh` is documented for the Anthropic Messages protocol, not for Bedrock's OpenAI-compatible door. One vendor, two doors, two vocabularies. |

### Left out: a per-turn token or cost budget

Token counts are known only **after** they are spent. Before sending there is
only an estimate, and gating on an estimate fails in both directions: generous
and it stops nothing, tight and it cuts a long job that was going fine right
down the middle - usually where a file is half-edited.

What already exists does the same work against values that can actually be
counted: the step cap, spin detection (same tool failing the same way), `/cost`
now split into cache reads, cache writes and thinking tokens, and `/think auto`
keeping large values off light turns.

A numeric lock belongs after measurement. Nothing was measured before this
release; this is the first version that measures at all.

---

## 4c. Defects the build itself surfaced

Three of these were found by the new tests, not by review. Recording them
because each is a shape that will recur.

| Where | Defect | Shape |
|---|---|---|
| `세대()` in `wire.js` | `claude-3-5-sonnet-20241022` parsed as generation **20241022**, so thinking was switched on with `adaptive` - which that model rejects with a `400`. The new-style pattern was tried before the old-style one. | A broad pattern tried before a narrow one silently swallows the narrow case. |
| `세션이름짓기()` | A Windows path survived sanitizing with the user name and folder names intact. | Filtering that removes characters never looks at what is left. |
| `배울전선()` | `deprecated`, `unrecognized`, and a field named before its reason were all unparsed, so three real endpoints could never learn and would re-take the same `400` every session. | A vocabulary list assembled from one vendor's wording. |
| Loop refusal handling | A refusal carries no tool call, so the nudge read it as "tried to finish after only reading" and pushed again for every remaining step. | Two very different states that look identical through one field. |

---

## 4d. Defects an adversarial review surfaced after the build

A review agent read the finished change with one instruction: find what breaks.
Six findings, all real, all fixed before the tag. Recording them because the
first three share one shape - **the change made a dormant assumption load-bearing.**

| Where | Defect | Why the build created it |
|---|---|---|
| `짝맞추기()` in `loop.js` | Read tool calls from `last.tool_calls` only. That is the OpenAI shape; the Anthropic shape carries them as `tool_use` blocks inside `content`. So on that protocol the function had never once done its job. | The Anthropic wire shape existed before, but no candidate endpoint reached the agent loop through it. Adding the mantle Anthropic door made a dead path live. |
| Refusal exit in `loop.js` | Returned without pairing tool calls at all. A refusal usually carries none - but streaming can open `tool_use` blocks and only report the refusal in the final `stop_reason`. The next request then `400`s on the whole conversation. | Three exits from the loop; the two older ones paired, the new one did not. |
| `배운다()` input in `loop.js` | Learned the token-estimate factor from `usage.in`. On the Anthropic protocol that field counts **only the tokens after the last cache breakpoint**, so a good cache hit shrinks it - and the shrunken value lands inside the trusted `[0.5, 2]` band, dragging the factor down and **persisting it to disk**. | Before this change nothing was cached, so `in` and "what we sent" were always the same number. Making the cache work split them. |
| `#전선열쇠()` in `evolve.js` | Keyed the learned wire card by `model@host`, path deliberately stripped. mantle serves `/openai/v1` and `/anthropic/v1` on the **same host with the same model id**, so one door's learned card was applied to the other - switching thinking and cache marks silently off. | Dropping the path was right for deployment names and version numbers. It was wrong the moment one host served two protocols. |
| `미리기다릴까()` in `quota.js` | Read a single process-global quota with no connection identity, so one endpoint reporting `remaining: 0` made the next request to **any other endpoint** sleep - including a local model a sub-task had delegated to. | The value was display-only until this change started gating sends on it. |
| `잊기(경로)` on fold | Passed the model-supplied path (usually relative); the file memory is keyed by the resolved absolute path. The `Map.delete` missed silently, so the exact bug the code's own comment claims to prevent survived. | Two sides of one key, written in two files, never compared. |

Two smaller ones from the same review, also fixed: the refusal text was never
shown to the user on the OpenAI shape (that protocol delivers it in one piece at
the end rather than streaming it), and `/cost` measured the cache hit rate against
a denominator that meant different things on different protocols.

**What generalizes.** Every one of the first three is the same move: a field, a
key, or a code path that was *unambiguous while one thing was true*, and stopped
being unambiguous when the change made the other thing true. None of them were
introduced as wrong code. They were correct code whose premise the change removed.
The tests added for each assert the invariant, not the fix - each was confirmed to
fail against the pre-fix code.

---

## 4e. What a second review round found — one assumption, six call sites

The first review round fixed `짝맞추기` and I treated that as *the* fix. It was
one call site of a much larger assumption: **"a tool call lives in
`m.tool_calls`, a tool result lives in `role:'tool'`."** That is the OpenAI
shape. The Anthropic shape puts calls in `content` as `tool_use` blocks and
results in a **user** message as `tool_result` blocks.

Five more places believed the OpenAI shape, and every one of them **failed
silently** — the failure mode is always "did nothing, reported success".

| Where | What it silently did on Anthropic connections |
|---|---|
| `safeCut` / `safeHead` (`session.js`) | Never pulled the cut point back, so compaction split a tool pair. Every request after that returns `400` and only `/clear` recovers — at the highest-context moment of a long session. |
| `foldToolResults` (`compact.js`) | Folded **zero** results. The cheap lossless 55% stage was inert on exactly the wire where the prompt cache matters most; every compaction went straight to lossy summarization. |
| `transcript` (`compact.js`) | Labelled every tool result as `사용자` and skipped the 400-char truncation, so full tool payloads went into a 1,200-token summarize call — and that summary then *replaced* the conversation. |
| `repairToolPairs` (`session.js`) | Reported `고친것: 0` on a conversation killed mid-tool. Resume and `/undo` handed back a history whose first request `400`s. The docstring says this function exists to prevent exactly that. |
| `breakdown` (`session.js`) | Counted tool output as conversation, so `/context` showed "tool results: 0 tokens" — the table you read to decide what to prune pointed the wrong way. |

**The fix is not five fixes.** The shape knowledge now lives in one place —
`부른것들` / `결과들` / `도구결과인가` in `backend/adapter.js`, next to the
`assistantMessage` / `toolMessage` that *write* those shapes. Readers beside
writers. A fourth wire shape changes one file.

### Three more of the same family

- **`배울전선` could not tell "this field is rejected" from "this value is
  wrong."** `thinking.budget_tokens must be greater than or equal to 1024` is a
  *size* complaint; it was read as "budget_tokens is unsupported", which flipped
  the card to `adaptive` **and wrote it to disk**. A budget-only model then
  `400`s in every future session with no way for the user to know why. Value
  complaints now teach nothing — except the one that enumerates valid values,
  which is the only sentence in that family worth learning from.
- **`/model` never reattached the wire card.** Switching endpoints kept the old
  one, so thinking, cache marks, and streaming usage could all be off while
  `/status` printed the old card's description. Screen and wire disagreeing is
  the precise failure this module exists to eliminate.
- **`잡힐만한가` compared a character count against `tokens * 2`.** Correct for
  English, wrong by half for Korean, so on Bedrock's 4,096 minimum we attached
  marks that would never be honoured and reported "cache marked". The estimator
  now lives in one leaf module (`backend/tokens.js`) that both the agent layer
  and `cachemark` use — two rulers eventually disagree.

### And one hole the new tests found

Writing the missing test for "`@` cannot attach deel's own files" surfaced that
**`mcp.json` was not on the blocked list** — it holds each MCP server's `env`,
which is where tokens live. `config.json` was blocked; its sibling was not.
A blocklist leaks exactly this way: someone adds a file of the same kind and
does not add the row.

### What generalizes

Every item above is the same shape as `4d`: code that was correct while one
thing was true. The difference this round is that **the first fix made the
assumption look handled.** Fixing one call site of a shared assumption is more
dangerous than fixing none, because it removes the symptom that would have led
someone to the other five.

The tests added this round assert the invariant on **both wire shapes in the
same loop**, so a shape-blind change fails on the shape it forgot.

---

## 5. Acceptance

- `/cost` reports cache reads and writes separately.
- Across the steps of one turn, cache reads grow instead of sitting at the static head.
- One conversation appears as one session **where the vendor documents a slot for it**
  (`metadata.user_id` on the Anthropic protocol, `prompt_cache_key` and `user` on OpenAI
  direct). Nowhere else — an undocumented field for no measurable gain is a `400` waiting
  to happen at any endpoint strict about unknown fields.
- `/think max` reaches the model's real top rung, and the screen matches the wire.
- Thinking works on Opus 5 without a 400.
- A 429 pauses the turn instead of killing it.
- A re-read after a fold returns the whole file once.
- A refusal leaves the conversation in a state the next request can be built from,
  on every wire shape - and says what the model actually said.
- The token-estimate factor is learned from what was **sent**, not from what the
  server billed as fresh input, so a working cache cannot corrupt it.
- A learned wire card never crosses between two protocols served from one host.
- An exhausted quota at one endpoint never stalls a request to another.
- Every history-maintenance path — cut, fold, repair, transcribe, measure —
  behaves identically on all three wire shapes, asserted side by side.
- A server complaining about a *value* teaches the wire card nothing; only
  "this field is not accepted" is learned, and only that is persisted.
- Switching connections with `/model` re-derives the wire card from scratch.
- deel's own files, including `mcp.json`, cannot be attached with `@`.
- No new dependency, one network door, no new egress.
- `npm test`, `CI=true node test/run.mjs`, and a PowerShell run are all green.
