[← back to README](../../README.md)

# Speed and spend

Per-stage effort, the prefix cache, context length, reply-length cap

---

## Reasoning effort

<sub>The wire card · Cache marks · Effort follows the request · Context length is read off the model · /out · Truncated tool calls · When the server pushes back</sub>

### The wire card — what this model actually accepts at this address

Two endpoints can speak the same protocol and still accept different fields. So deel
settles on one **wire card** when the session opens and sends with that card for the
rest of the session. `/status` and `/think` both show it as one line.

```
  wire       thinking adaptive · rungs low·medium·high·xhigh·max · cache marked
```

| Field | Meaning |
|---|---|
| thinking | How thinking is switched on — `adaptive` · `budget_tokens` · `reasoning_effort` · `on/off` |
| rungs | The effort words this endpoint accepts |
| cache | Who catches the cache — `marked` (we attach it) · `key` · `server-side` · `none` |

The card is settled in three steps, the same way deel works out context length.

1. **Guess** — from the vendor in the address and the version in the model name
2. **Learn** — when the server answers `400`, read what it refused out of the message
3. **Keep** — write it down per model and address, and start there next time

When it learns, one line appears and the request goes out again with the fixed card.

```
  ⚙ The server does not take that field — retrying with it adjusted (thinking)
```

**Nothing extra is sent to an address deel does not recognize.** Corporate gateways
commonly answer `400` to a single unknown field. If "broaden compatibility" turned into
"guess extra fields at unknown endpoints," a working install would die on an upgrade.
So when the vendor is unknown, the request body is **byte-for-byte what it was before**
(`test/wire.test.js` holds that line).

#### Rungs by vendor

| Endpoint | Accepted words |
|---|---|
| Claude — Anthropic Messages body (direct · Bedrock mantle) | `low` `medium` `high` `xhigh` `max` |
| Claude — OpenAI-compatible body (Bedrock runtime) | `minimal` `low` `medium` `high` |
| OpenAI | `minimal` `low` `medium` `high` |
| Gemini | `none` `low` `medium` `high` |
| Azure | `low` `medium` `high` |
| Ollama | true/false |

**The same vendor follows the body's protocol.** That is why the first two rows differ.
`xhigh` and `max` go out only on an Anthropic Messages body — whether the
OpenAI-compatible endpoint accepts those words is not confirmed in the docs, and sending
an unconfirmed word costs the whole turn a `400`. Narrowing wrongly costs some reasoning;
widening wrongly costs the turn.

A word this endpoint does not have is lowered to **the nearest one below that it does
have**. Set `/think max` and connect to OpenAI and `high` goes on the wire.
**Nothing is ever raised.** If you picked `low` and deel sent `medium`, that is a
different job than the one you asked for, billed at a number you did not choose.

### Cache marks — stop resending the head

A prompt cache only matches **a prefix**. Something has to say how far that prefix runs,
and each protocol says it differently.

| Endpoint | How | Left unmarked |
|---|---|---|
| Anthropic direct | `cache_control` marks | **Nothing** is cached |
| Bedrock · Gemini · Azure | The server does it | Only the static head is cached |
| OpenAI direct | `prompt_cache_key` | It cannot tell this is the same conversation |

Where marks are accepted, deel attaches **two**.

- The end of the **stable half of the system prompt** — this catches the tool schemas too
- The **last usable block of the conversation** — everything up to here freezes this turn

Past twenty messages it drives one more **anchor** into the middle. The lookback window
is twenty positions, so without an anchor the whole head goes out again the moment the
conversation walks past it.

Thinking blocks and empty text never get a mark. Thinking blocks arrive signed and
touching one gets the whole turn rejected; a mark on empty text is refused outright.
Below the minimum cacheable size (1,024 on Anthropic, 4,096 on Bedrock) a mark catches
nothing, so none is attached.

`/cost` shows how much is actually landing.

```
  Cache      read 48,200 · written 6,100 · 78% hit
```

**Writes with zero reads** means the head is being rebuilt every single time. `/cost`
says so in the same place.

The share of output tokens spent on thinking shows up alongside it. That is where the
price of a high `/think` setting becomes a number.

```
  Thinking   12,400 tokens · 61% of output
```

Many endpoints do not report this. When they don't, the line is absent — writing an
unknown as zero reads as "it did not think," which is not the same fact.

### Effort follows the request — `/think auto`

With `/think max` set, "hi" ran at maximum reasoning. Slow, expensive, and the prefix
kept shifting underneath it.

Turn `auto` on and your setting becomes a **ceiling**. Light turns come back fast at a
low rung; real work climbs to the ceiling.

```
  /think auto        toggle
  /think             show the current value and the ceiling
```

| What you typed | What goes out under `/think max` |
|---|---|
| `hi` · `thanks` | `low` |
| `fix src/a.js` | `max` |
| `yes` after a long conversation | `max` |

That last row is the important one. Short is not automatically light — a bare "yes" can
be the turn that picks up everything said before it.

**The ceiling is never exceeded.** If you set `/think low`, `medium` never goes out.

On turns that leave the machine, effort is **pinned** for the whole turn. Effort that
moves between steps is a prefix that moves between steps, and a moving prefix is a cache
rebuilt every call.

### The session name

Endpoints that catch the cache are told **this conversation is that earlier one**. On the
Anthropic protocol that rides in `metadata.user_id`; on OpenAI direct it goes out as
`prompt_cache_key` and `user`.

It carries **the conversation number and nothing else** — no path, no address, no user
name, no key. Anything that is not already a conversation number is replaced wholesale by
a fingerprint rather than filtered. Filtering does not look at what survives: strip a path
and the person's name and folder names are still sitting there.

### A refusal is not pushed again

When the model declines on safety grounds (`stop_reason: refusal`), the turn stops there.

A refusal usually carries no tool call, so deel used to read it as "tried to finish after
only reading" and push once more. The verdict does not change, so it refused again, and
that repeated for as many steps as were left. One request that was going to be refused
went out ten times, and those ten pushed the per-minute limit up until the next real
request took a `429`.

```
  ⚠ The model declined this request — stopping here instead of pushing again
```

`deel run` exits **6** with `reason` set to `refusal`. Exiting `0` would let the next
step of a script proceed as though the work had happened. It is kept separate from an
error (`1`) because the fix is different: an error means checking the connection or the
key, a refusal means **changing what you asked for**.

### Waiting before sending when the quota is empty

Some servers report the remaining quota and the reset time in response headers. While
that number is zero and the reset time is known, deel waits **before** sending.

```
  ⏸ Quota is empty — waiting 12s before sending
```

The outcome matches sending and backing off from a `429`, except no request is wasted.
That matters because each wasted request pushes the limit up again. If the wait would run
past a minute, or the reset time is unknown, it just sends — turning "unknown" into
"wait" stalls requests that would have worked.

### Context length is read off the model

This one number sizes the whole program: how many files fit in one read, when the
conversation gets folded, how long a single reply may be — **all of it comes from here.**

So deel asks the server on every launch rather than trusting the saved value. The same
model name can be loaded at a different length each time, and if that difference never
reaches the screen there is no way to notice. **It just quietly gets smaller.**

```
 │ Model    qwen3-coder  (640k tokens)                     │
 ╰─────────────────────────────────────────────────────────╯
 ✓ Context adjusted 32,768 → 655,360 (read from LM Studio)
```

Every server puts this number under a different name in a different place, so deel checks
all of them.

| Server | Where it reads |
|---|---|
| LM Studio | `/api/v0/models` — `max_context_length`, `loaded_context_length` |
| llama.cpp | `/props` — `n_ctx` |
| vLLM | `/v1/models` — `max_model_len` |
| Ollama | `/api/show` — `<model>.context_length` |
| Other OpenAI-compatible | `/v1/models/<model>` — `context_window`, `context_length`, `max_input_tokens`, `max_position_embeddings` (found even when nested) |

**Model maximum and loaded length are not the same thing.** LM Studio will happily load a
655,360-capable model at 8,192. Trusting the maximum there gets your requests rejected. So
the **loaded length is what deel uses**, and the maximum is reported separately.

```
 ⚠ This model goes up to 655,360 — raise it on the server, then /ctx auto
```

| Command | What it does |
|---|---|
| `/ctx` | Current length and remaining room |
| `/ctx auto` | Ask the server again and match the model |
| `/ctx 655360` | Set it yourself (`640k`, `128k`, `1m` also work) |
| `/ctx 자세히` | Which endpoints were probed and what each returned — how to see why a lookup failed |
| `deel --ctx 655360` | Start at this value (skips the lookup) |

**`k` means 1024 here.** Context lengths are all powers of two, so that is the only base
that lines up: 655,360 is `640k`, not `655k`; 131,072 is `128k`, not `131k`. The display and
`/ctx` use the same unit, so typing back what you see gives you the same number.

### Reply length cap — `/out`

Context (how much can be held) and the **output cap** (how much can come back at once) are
different numbers. Treating them as one makes it impossible to understand why a large file
never gets written — the context is roomy while the reply is being cut.

| Command | What it does |
|---|---|
| `/out` | Current cap and **where it came from** (set by you / discovered / default) |
| `/out 32k` | Set it yourself (`k` is 1024). Saved to the profile |
| `/out auto` | Drop your value and go back to the discovered one, or the default |
| `deel --max-tokens 65536` | Start at this value |

The old name `/ctx out 32k` still works.

**Caps are not fixed numbers.** They are computed from the model's context window and how
much of it is currently used — the profile decides what share of the remaining room a stage gets.

| Model | First call | Continuing | Stuck | Retry after truncation |
|---|---|---|---|---|
| 2k local | 819 | 716 | 921 | 1,638 |
| 8k local | 3,276 | 2,867 | 3,686 | 6,553 |
| 40k (qwen3) | 16,384 | 14,336 | 16,384 | 16,384 |
| 128k gateway | 16,384 | 16,384 | 16,384 | 16,384 |
| 128k, 80% full | 10,485 | 9,174 | 11,796 | 16,384 |
| 640k with `/out 65536` | 65,536 | 65,536 | 65,536 | 65,536 |

Caps shrink as the context fills. Handing a 4k model a 4,096-token cap would leave no room for input.

The last row is the point: **a known cap overrides the 16,384 default.** For a while it did
not — the third argument of `Math.min(cap, max ?? 16384, 16384)` clamped it right back, so a
configured cap could only be lowered, never raised. Meanwhile the comment, the README, and the
on-screen help all said it could be raised. A documented escape hatch that is welded shut is
the worst kind.

If a cap truncates a reply, **the call is retried with the cap lifted** — and the thinking
level drops one notch, because reasoning tokens eat the same budget first. Without that, more
headroom just buys more thinking. A truncated reply means a half-written tool call, which fails silently.

**When the server refuses, it is read for the answer.**

```
This model's maximum context length is 8192 tokens, however you requested 41003
```

The number is extracted, applied, and the call is retried. You never see the failure.
No spec knowledge is needed, so **this works against servers we have never seen.**

### Truncated tool calls

This actually happened. A user asked for a dashboard; the model tried to put an entire HTML
document into `Write`'s arguments, hit the output token limit, and the arguments JSON arrived
cut off mid-string.

The old code quietly turned that unparseable JSON into `{_raw: "..."}` and handed it to the
tool. The tool answered `path is empty` — **a message with nothing to do with the real cause.**
The model had not omitted the path, so there was nothing to fix; it retried identically, and
was truncated again.

```
  ◆ Write(dashboard.html)
    └ path is empty          ← nine identical times

  ── 71s · 13 tool calls · context filled and auto-compacted · no file produced
```

One silently swallowed value produced all of that. What happens now:

| | Now |
|---|---|
| Unparseable arguments | **Marked as truncated**, not swallowed. Never passed to the tool |
| The model is told | Exactly what happened, and to stop resending the whole thing — write a short skeleton first, then **build it up with `Edit`** |
| The truncated payload | Never re-injected into the conversation — it is half a payload and it costs context |
| Detecting truncation | Even when the gateway reports `finish_reason: "stop"`, **broken arguments are themselves proof it was cut.** No model writes half a JSON object on purpose |
| Three identical failures | The turn stops, with a suggestion to split the request |

```
  ⊘ Stopped — it is spinning in the same place.
    the same tool call keeps getting truncated
    What you asked for in one go is larger than the model's output cap. Try splitting it —
    e.g. "just the skeleton first" → "now add the table" → "now add the chart"
```

**A step limit (`maxSteps`) cannot catch this.** It cannot tell a long healthy task from a
spinning one. What is counted here is not steps but **how many times the same tool failed for
the same reason.**

### When the server pushes back — 429 · 5xx · dropped connections

Corporate gateways rate-limit per user, so `429` is routine; when the model behind one
restarts, `502`/`503` show up for a few seconds; sometimes the connection just drops. All
three mean "send the same request again in a moment", so the turn is not killed — deel
waits and calls again.

```
  ↻ The server pushed back (HTTP 429) — calling again in 2s (1/3)
```

| | |
|---|---|
| Retried | `408` `429` `500` `502` `503` `504` `529`, and a connection dropped before any headers arrived |
| Not retried | `400` `401` `403` `404` — calling again would give the same answer. Connection refused (server is down) and timeouts are not retried either |
| How many | Three times. After that it says so, with the number of attempts |
| How long | `Retry-After` if the server sends one (capped at 60 s). Otherwise 1 s → 2 s → 4 s with up to 30 % jitter |
| Dropped after text has streamed | Not retried — a half-received answer must not come back twice. The salvage path takes over |
| Ctrl+C while waiting | Stops immediately |

The count shows in `/cost`, and `deel run --json` reports it as `usage.retries`.

---

[← back to README](../../README.md)
