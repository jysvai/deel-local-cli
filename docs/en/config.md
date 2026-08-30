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
| Azure OpenAI | `https://<name>.openai.azure.com/openai/deployments/<deployment>` |
| Ollama | `http://localhost:11434` |
| LM Studio | `http://localhost:1234/v1` |
| llama.cpp · vLLM · LiteLLM | `http://host:port/v1` |

Auth style is detected automatically: `Authorization: Bearer` → `x-api-key` → `api-key` → none.
Azure addresses use a different order: `api-key` → `Bearer` → none (`x-api-key` is not tried).
**Every style is tried before one is chosen** — the first 401 does not end the search, because an
Azure front end wrapped in Entra ID answers 401 to `api-key` and accepts `Bearer`.

### Azure OpenAI

Azure calls itself OpenAI-compatible, and **only the address shape differs.** The model name lives
in the URL, `?api-version=` is mandatory (400 without it), the model list is at
`/openai/deployments` rather than `/models`, and the key goes in an `api-key` header. Paste the
address exactly as the portal shows it: with `/openai/deployments/<deployment>` it connects to that
deployment; with just the resource address it fetches the deployment list to pick from. A trailing
`/chat/completions?api-version=…` is stripped for you.

`api-version` comes from the address when it is there, otherwise the GA version (`2024-10-21`). If
your organisation pins a version, set `"apiVersion"` in the config file or the
`DEEL_AZURE_API_VERSION` environment variable.

An address mounted one level down behind a front end such as APIM
(`https://apim.corp/azure-openai/openai/...`) keeps that prefix.

Listing deployments is a separate permission and is often blocked. That is **not treated as a
failed connection** — with a deployment in the address it connects anyway and says the list could
not be read. A server that returns **nothing at all**, though, is a failed connection: calling a
closed port or a down VPN "the list was blocked" sends people to debug the wrong thing. Azure does not report context length over the API, so set that yourself with `/ctx`
or in the config.

### Environment variables

| Variable | Use |
|---|---|
| `DEEL_API_KEY` | Keep the key out of the config file (takes precedence) |
| `DEEL_KEY_<PROFILE_ID>` | Per-profile key |
| `NODE_EXTRA_CA_CERTS` | Corporate TLS certificate |
| `HTTPS_PROXY` · `HTTP_PROXY` | Behind a proxy — `http://user:pw@proxy:port`. Lower-case names work too. deel opens the CONNECT tunnel itself, so this works on every Node version |
| `NO_PROXY` | Where not to use the proxy — `.corp.com, 10.1.2.3, intra:8443, *`. This machine (localhost · 127.*) always goes direct. CIDR (`10.0.0.0/8`) is not understood — list addresses one by one, or use a domain suffix |
| `DEEL_SHELL` | Which shell the `Bash` tool uses on Windows — `auto` (default: bash if Git Bash is installed, else cmd) · `bash` · `cmd` · `powershell`. `"shell"` in the config file works too. The pick shows in `/status` and in the `Shell:` line the model is given |
| `DEEL_KEYSTORE=off` | Keep the key in the file instead of handing it to the machine keystore (Windows DPAPI · macOS keychain). For places where policy blocks PowerShell — whatever it ends up doing is printed verbatim in the `열쇠 보관` line of `/status` |
| `DEEL_DEBUG=1` | Verbose errors |
| `NO_COLOR` | Disable colour |
| `DEEL_NO_MOTION=1` | Turn off the working animation (falls back to a one-cell spinner) |
| `DEEL_MOTION` | Change that animation — `knight` · `animal`. For this run only; `/motion` is better for keeping it. [See](interface.md#changing-the-drawing) |
| `DEEL_OFFICE=1` | Pin a twelve-row office above the input box (same as `/motion office`). [See](interface.md#the-office--what-is-running-drawn-as-a-room) |

The proxy can also be set in the config file — `"proxy": "http://user:pw@proxy:port"` takes precedence over the environment, and `"proxy": "none"` bypasses it even when the variables are set. While one is in use, the first screen and `/status` show `proxy …`. Only `http://` proxies are supported (Basic auth); proxies that accept only NTLM · Negotiate cannot be used.

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
