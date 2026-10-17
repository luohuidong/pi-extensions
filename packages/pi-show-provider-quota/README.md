# Show Provider Quota For Pi Coding Agent

A [pi](https://github.com/earendil-works/pi) extension that shows the active
model provider's subscription quota in the bottom status bar of the TUI.

One extension, one status row, one command — the vendor is picked from the
active model's provider. Two providers ship today; adding another is a single
adapter module plus one entry in `src/providers/index.ts`.

| Provider        | Model provider id | Rendered line                      |
| --------------- | ----------------- | ---------------------------------- |
| MiniMax (China) | `minimax-cn`      | `MPlan·5%(11m)·7%(1d9h)`           |
| OpenCode Go     | `opencode-go`     | `Go·1%(3h28m)·6%(4d7h)·3%(28d20h)` |

## Install

Install from npm:

```bash
pi install npm:pi-show-provider-quota
```

For a one-off test run without installing:

```bash
pi -e npm:pi-show-provider-quota
```

## Activation

The row only appears when the active model's provider is one of the supported
ones. Any other provider leaves the footer untouched — there is no "disabled"
placeholder, the line simply does not appear.

Provider switches mid-session are handled by adapter identity:

| Transition                                        | Behavior                      |
| ------------------------------------------------- | ----------------------------- |
| another provider → a supported provider           | fetch and show the line       |
| a supported provider → another provider           | clear the row                 |
| between two models of the same supported provider | nothing (no request)          |
| between two supported providers                   | repaint and fetch the new one |

Switching between two models of one vendor — OpenCode Go's GLM to Kimi, say —
deliberately does not re-query: the quota is account-wide, so the numbers
cannot have changed.

## Percentages are "used"

Every provider is normalized to **used** percentages before rendering, so a
single set of color thresholds applies everywhere:

- under 70% used → green
- 70% up to 89% used → yellow
- 90% and above → red

MiniMax's API reports _remaining_ percentages, so this extension converts them
with `100 - remaining` before display. A MiniMax account with 80% left shows
`20%`. Values are shown exactly as derived — no rounding.

## Refresh behavior

There is no polling. The row is fetched on pi session start, after every
settled agent run, once when the active provider crosses a vendor boundary,
and on demand via `/show-provider-quota`.

- Refreshes are throttled to one fetch per provider per 30 seconds. A turn
  that settles inside that window keeps the previous numbers.
- Each provider keeps its own cache and timestamp, so switching back and forth
  does not re-query a provider whose data is still fresh.
- The countdown is a snapshot: an idle session keeps showing the numbers and
  reset time from the last fetch rather than ticking down.

## What each provider shows

### MiniMax Token Plan (`minimax-cn`)

```plaintext
MPlan·5%(11m)·7%(1d9h)
```

**The two groups are positional and carry no labels.** The order is always 5h →
7d; the labels were dropped to keep the row narrow, so the order is part of the
line's contract. Run `/show-provider-quota` for the same numbers with the
window names spelled out.

Quota comes from the China-region Token Plan endpoint
`https://api.minimaxi.com/v1/token_plan/remains`. Per the upstream contract the
first `model_remains` entry carries the canonical state, so only that entry is
read.

| Field    | Meaning                                              |
| -------- | ---------------------------------------------------- |
| `MPlan`  | Title label, dim color                               |
| `5%`     | 5-hour used percent (`100 - remaining`), first group |
| `(11m)`  | Milliseconds until the 5-hour window resets          |
| `7%`     | 7-day used percent (`100 - remaining`), second group |
| `(1d9h)` | Milliseconds until the 7-day window resets           |

A Token Plan key starts with `sk-cp-…`. A pay-as-you-go key (`sk-api-…`)
authorizes a different endpoint, so it is reported separately instead of
failing vaguely.

### OpenCode Go (`opencode-go`)

```plaintext
Go·1%(3h28m)·6%(4d7h)·3%(28d20h)
```

**The three groups are positional and carry no labels.** The order is always
rolling → weekly → monthly; the labels were dropped to keep the row narrow, so
the order is part of the line's contract. Run `/show-provider-quota` for the
same numbers with the window names spelled out.

Usage comes from the official endpoint
`https://opencode.ai/zen/go/v1/usage` with the same API key the provider uses
for inference.

| Group | Window             | Percent source          | Countdown source         |
| ----- | ------------------ | ----------------------- | ------------------------ |
| 1     | rolling (~5 hours) | `usage.rolling.percent` | `usage.rolling.resetsAt` |
| 2     | weekly (~7 days)   | `usage.weekly.percent`  | `usage.weekly.resetsAt`  |
| 3     | monthly (~30 days) | `usage.monthly.percent` | `usage.monthly.resetsAt` |

A window with no usable reset time omits its parentheses, shrinking the line to
`Go·1%·6%·3%`. A key from a workspace without a Go plan answers `403`; because
Zen and Go share one workspace key, this is a common mix-up and gets its own
message.

## Manual refresh and breakdown

Run `/show-provider-quota` to show a labelled breakdown and refresh the row:

```plaintext
OpenCode Go usage (used %)
  Rolling 1% (3h28m)
  Weekly  6% (4d7h)
  Monthly 3% (28d20h)
```

A cached breakdown younger than 30 seconds is printed immediately; otherwise the
command fetches first. If a fetch is already in flight it announces that and
waits for it instead of firing another. Outside a supported provider the
command refuses to run and says which provider is active; if the fetch failed
it says so instead of printing stale numbers.

## Status messages

When a supported provider is active and something goes wrong, a dim
placeholder keeps the footer from going blank. On any other provider the footer
is left untouched.

| Message                                             | Provider | When                                                                 |
| --------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| `MiniMax Token Plan: loading…`                      | MiniMax  | cache missing or stale                                               |
| `MiniMax Token Plan: no credentials`                | MiniMax  | no usable `minimax-cn` api-key                                       |
| `MiniMax Token Plan: need Token Plan key (sk-cp-…)` | MiniMax  | the stored key is pay-as-you-go (`sk-api-…`)                         |
| `MiniMax Token Plan: no quota data`                 | MiniMax  | endpoint returned an empty or unrecognized payload                   |
| `MiniMax Token Plan: error`                         | MiniMax  | any other failure (network, non-2xx, parse)                          |
| `OpenCode Go: loading…`                             | OpenCode | cache missing or stale                                               |
| `OpenCode Go: no credentials`                       | OpenCode | no usable `opencode-go` API key                                      |
| `OpenCode Go: invalid key`                          | OpenCode | HTTP `401`                                                           |
| `OpenCode Go: no Go subscription`                   | OpenCode | HTTP `403` — valid key, workspace without a Go plan                  |
| `OpenCode Go: no quota data`                        | OpenCode | `200`, but no window carried a usable percentage                     |
| `OpenCode Go: error`                                | OpenCode | any other failure: network, timeout, other non-2xx, unparseable body |

## Development

```bash
pnpm install
pnpm test          # node --test
pnpm typecheck     # tsc --noEmit
```

Tests cover the shared controller (provider switching, throttling, per-provider
in-flight dedup, cache retention), the command wiring, and each provider's auth
resolution, HTTP mapping, aggregation, and formatting. They run against stub
`fetch` implementations and a stub theme, so no network access or real ANSI
palette is involved.

See [`AGENTS.md`](./AGENTS.md) for the package's internal contracts and how to
add a provider.

## License

MIT
