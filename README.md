# Show Minimax Quota For Pi Coding Agent

A [pi](https://github.com/badlogic/pi-mono) extension that shows the current
MiniMax **Token Plan** quota in the bottom status bar of the TUI.

The line renders as

```plaintext
MiniMax Token Plan · 5h 80% (3h12m) · 7d 65% (4d6h)
```

and is refreshed whenever pi starts a session (`session_start`) or settles after
an agent run (`agent_settled`). Quota is fetched from the **China-region**
Token Plan endpoint only — `https://api.minimaxi.com/v1/token_plan/remains`.

## Install

```bash
pi install npm:minimax-quota-show-for-pi
```

or for a one-off test run without installing:

```bash
pi -e npm:minimax-quota-show-for-pi
```

## Prerequisites

- `pi` installed globally
- A Token Plan API key (starts with `sk-cp-…`) exported as
  `MINIMAX_TOKEN_PLAN_API_KEY` before launching `pi`, e.g.:

  ```bash
  export MINIMAX_TOKEN_PLAN_API_KEY=sk-cp-…
  pi
  ```

The extension reads the key from this environment variable. No
companion CLI tool is required.

## What the bar shows

The Token Plan endpoint returns one entry per model bucket (`general`,
`video`, …). Per the upstream contract the **first entry** carries the
canonical quota state, so the bar surfaces only that:

| Field      | Meaning                                                            |
|------------|--------------------------------------------------------------------|
| `MiniMax Token Plan` | Title label, dim color                                              |
| `5h 80%`   | 5-hour remaining percent, read from the first entry's `current_interval_remaining_percent` |
| `(3h12m)`  | `remains_time` of the first entry (milliseconds), formatted as minutes/hours/days |
| `7d 30%`   | 7-day remaining percent, read from the first entry's `current_weekly_remaining_percent` |
| `(4d6h)`   | `weekly_remains_time` of the first entry (milliseconds), formatted as minutes/hours/days |

Groups are separated by a muted ` · ` so the line scans as
`title · 5h pct (reset) · 7d pct (reset)`.

The server already reports `current_interval_*_count` and
`current_weekly_*_count` as `0` on this endpoint and ships the
percentages pre-computed, so we do not aggregate or re-derive anything
from those columns.

The percent is colored **green / yellow / red** at the 50% / 20% thresholds
so low quota jumps out at a glance. The reset duration uses minute
precision only (no seconds), per the original spec:

- under 1 hour → `3m`
- 1 hour to < 1 day → `2h35m`
- ≥ 1 day → `5d8h` (minutes dropped)

## Manual refresh

Inside a pi session, run `/minimax-quota` to force a refresh — handy after
rotating the API key in your shell.

## Status messages

When something goes wrong the extension shows a dim placeholder so the
footer never goes blank:

| Message                          | When                                              |
|----------------------------------|---------------------------------------------------|
| `minimax: loading…`              | Shown synchronously at session start               |
| `minimax: no credentials`        | `MINIMAX_TOKEN_PLAN_API_KEY` unset or empty       |
| `minimax: no quota data`         | API returned an empty/unrecognized payload        |
| `minimax: error`                 | Any other failure (network, auth, parse, etc.)        |

## Development

```bash
pnpm install
pnpm test          # node --test
pnpm typecheck     # tsc --noEmit
```

Tests cover the aggregation, percentage disambiguation, time formatting,
and the full `formatStatusLine` output. The test suite uses a stub theme
so it does not depend on the real ANSI palette.

## License

MIT