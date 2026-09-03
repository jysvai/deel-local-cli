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

## 5. Acceptance

- `/cost` reports cache reads and writes separately.
- Across the steps of one turn, cache reads grow instead of sitting at the static head.
- One conversation appears to the gateway as one session.
- `/think max` reaches the model's real top rung, and the screen matches the wire.
- Thinking works on Opus 5 without a 400.
- A 429 pauses the turn instead of killing it.
- A re-read after a fold returns the whole file once.
- No new dependency, one network door, no new egress.
- `npm test`, `CI=true node test/run.mjs`, and a PowerShell run are all green.
