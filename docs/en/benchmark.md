[← Docs index](../../README.md)

# Benchmark — Claude CLI and deel

A head-to-head on the same project, given the same job.

Source: [`pdf/cli_benchmark_anonymized_v4.pdf`](../../pdf/cli_benchmark_anonymized_v4.pdf)

---

## First, what this data cannot say

That is the thing you most want to know when reading a vendor's own numbers, so it
goes first.

- **The sample is two runs.** "deel is generally 16.8% cheaper" is not something this
  data supports.
- **The conditions are not symmetric.** The Claude side had an external savings package
  attached (`claude-token-saver`); deel used only its own built-in behaviour. So the
  $1.33 gap **cannot be attributed to engine efficiency.**
- **Claude covered more regression scope.** That is the row we lost.
- The percentages are a **relative index with 100 = the better of the two observations**,
  not a percentile against any outside population.

---

## Conditions

|  | Claude CLI | deel |
|---|---|---|
| Model | Claude Opus 5 (AWS Bedrock) | Claude Opus 5 (AWS Bedrock) |
| Target | same project (collaborative editor) | same project |
| Task | find and fix a data-loss defect in concurrent editing | same |
| Extras | `claude-token-saver` (separate npm) | none — built-in only |
| Observed cost | **$7.90** | **$6.57** |
| Wall time | **38m 00s** | **36m 59s** (2,219s) |

Cost **-$1.33 (16.8%)** · Time **-61s (2.7%)**

---

## The two runs found different defects

Not the same bug twice — each removed a **different failure path** in collaborative
synchronisation.

**Claude CLI — base corruption during IME composition.**
While A is composing Hangul, a remote change from B arrives. Applying it to the screen
is deferred, but **the base value is updated first.** The next delta then reverts B's
change, and the server reads that as a legitimate edit.

**deel — await / TOCTOU race on the receive path.**
While `GET /api/state` is awaited to pick up a remote change, A types something new.
After the response there is **no re-check**, so the server document overwrites A's
input. The safety check taken before the `await` was assumed to still hold after it.

deel's path to it narrowed down as: 50-test server baseline → the client side nobody
had measured → an asymmetry among the `apply` call sites (only the receive path lacked
a rebase) → reproduction.

---

## By dimension

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/jysvai/deel-local-cli/main/docs/assets/benchmark-dark.svg">
  <img alt="Relative index by dimension" src="https://raw.githubusercontent.com/jysvai/deel-local-cli/main/docs/assets/benchmark-light.svg" width="900">
</picture>

| Dimension | Claude | deel |
|---|---|---|
| Value of the defect found | 100% | 100% |
| Depth of root-cause analysis | 100% | 100% |
| Systematic investigation | 95% | **100%** |
| Reproduction reliability | 100% | 100% |
| Minimality of the fix | 95% | **100%** |
| Test design | 100% | 100% |
| **Regression scope** | **100%** | 85% |
| Self-verification | 100% | 100% |
| Real-environment verification | 100% | 100% |
| Cost efficiency | 89% | **100%** |
| **Composite** | **97.9%** | **98.5%** |

Within 2 percentage points — the honest reading is **effectively equal** on quality.

---

## The row we lost, and what it changed

**Regression scope, 85%.** Claude ran that project's suites out to `50 + 11 + 18`;
deel stopped at `6 new + collaboration 50 + syntax`.

The cause was not skill, it was **the list**. That project's checks were three
standalone files under `scripts/` (`qa-collaboration.js`, `qa-presets.js`,
`qa-design-studio.js`), and deel's `Verify` only ever looked at the `test` field in
`package.json`. A check you never saw is a check you never run, and a check you never
run catches no regression.

**Fixed in 1.17.7** — `Verify` now finds **every** way this project checks itself
(`src/tools/확인법.js`): the `test` / `lint` / `typecheck` / `e2e` npm scripts,
standalone check files under `scripts/`, `test/`, `tools/`, and `cargo test`,
`go test`, `pytest`, `make test` where the marker for them actually exists.

It does not invent what is not there. `make test` is only listed when the `Makefile`
really has a `test:` target — offering a command that does not exist just makes the
model call it, fail, and call it again.

Pointed at this repository it goes from 1 to **6**.

---

## To measure this properly next time

Carried over from the recommendation in the source deck:

repeat the same class of task **5–10 times** across **three conditions** — stock
Claude, Claude + token-saver, and deel — recording cost, time, severity of the defect
found, lines changed, reproduction success, regression scope, and rework count. That
would separate tool efficiency far more clearly than two runs can.
