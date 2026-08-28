[← back to README](../../README.en.md)

# Configuration

Servers, environment variables, run flags, project rules

---

## Configuration

<sub>Supported servers · Environment variables · Flags · Project rules</sub>

### Supported servers

| | Example address |
|---|---|
| Corporate AI gateway (OpenAI-compatible) | `https://ai-gw.example.corp/v1` |
| Ollama | `http://localhost:11434` |
| LM Studio | `http://localhost:1234/v1` |
| llama.cpp · vLLM · LiteLLM | `http://host:port/v1` |

Auth style is detected automatically: `Authorization: Bearer` → `x-api-key` → `api-key` (Azure) → none.

### Environment variables

| Variable | Use |
|---|---|
| `DEEL_API_KEY` | Keep the key out of the config file (takes precedence) |
| `DEEL_KEY_<PROFILE_ID>` | Per-profile key |
| `NODE_EXTRA_CA_CERTS` | Corporate TLS certificate |
| `HTTPS_PROXY` | Behind a proxy |
| `DEEL_DEBUG=1` | Verbose errors |
| `NO_COLOR` | Disable colour |
| `DEEL_NO_MOTION=1` | Turn off the working animation (falls back to a one-cell spinner) |
| `DEEL_MOTION` | Change that animation — `knight` · `animal`. For this run only; `/motion` is better for keeping it. [See](interface.md#changing-the-drawing) |
| `DEEL_OFFICE=1` | Pin a twelve-row office above the input box (same as `/motion office`). [See](interface.md#the-office--what-is-running-drawn-as-a-room) |

### Flags

```bash
deel --root <folder>     Working scope. Defaults to the current folder
deel --mode <mode>       auto (default) / confirm / strict
deel --work <mode>       auto (default) / code / plan / architect / debug / ask / orchestrator
deel --level <level>     쉬움 (simple) / 개발자 (developer)
deel --ctx <length>      Set the context length yourself (655360 · 640k · 128k)
deel --max-tokens <len>  Cap on a single reply (32k) — same value as /out
deel --think <level>     off / low / medium (default) / high / max
deel --effort <profile>  even / save (default) / deep
deel --offline           Nothing leaves this machine
deel --continue          Resume the most recent conversation
deel --resume <id>       Resume a specific one
deel --no-tui            Turn the input box off; plain scrolling view (see below)
```

### Project rules

If the working folder has `DEEL.md`, `CLAUDE.md` or `AGENTS.md`, it is loaded as project rules.
`/init` scaffolds one.

---

[← back to README](../../README.en.md)
