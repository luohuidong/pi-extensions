# Show Minimax Quota For Pi Coding Agent

A [pi](https://github.com/earendil-works/pi) extension that shows the current
MiniMax **Token Plan** quota in the bottom status bar of the TUI.

The line renders as

```plaintext
MiniMax Token Plan · 5h 80% (3h12m) · 7d 65% (4d6h)
```

and is refreshed whenever pi starts a session (`session_start`) or settles after
an agent run (`agent_settled`). Quota is fetched from the **China-region**
Token Plan endpoint only — `https://api.minimaxi.com/v1/token_plan/remains`.

## Install

The extension lives in the `packages/show-minimax-quota-for-pi` subdirectory of a
pnpm workspace. Install from GitHub by appending the subpath:

```bash
pi install github:luohuidong/show-minimax-quota-for-pi#packages/show-minimax-quota-for-pi
```

or for a one-off test run without installing:

```bash
pi -e github:luohuidong/show-minimax-quota-for-pi#packages/show-minimax-quota-for-pi
```

> If your version of `pi` does not accept the `#subpath` form, clone the repo
> and `pi install` (or `pi -e`) the local package directory instead:
>
> ```bash
> git clone https://github.com/luohuidong/show-minimax-quota-for-pi
> pi -e ./show-minimax-quota-for-pi/packages/show-minimax-quota-for-pi
> ```

## Prerequisites

- `pi` installed globally
- A Token Plan API key (starts with `sk-cp-…`) exported as `MINIMAX_TOKEN_PLAN_API_KEY` before launching `pi`. To set the key only for the current session, run the `export` line inline and launch `pi` right after:

  ```bash
  export MINIMAX_TOKEN_PLAN_API_KEY=sk-cp-…
  pi
  ```

  To persist it across sessions, add the `export` line to your shell config (e.g. `~/.bashrc` or `~/.zshrc`) and start a new shell:

  ```bash
  export MINIMAX_TOKEN_PLAN_API_KEY=sk-cp-…
  ```

  Then run `pi` from that shell.

## Activation

The extension only renders when the active model's provider is
`minimax-cn` (the China-region MiniMax provider that exposes the Token
Plan endpoint). Any other provider leaves the footer untouched — there
is no "disabled" or "unsupported" placeholder, the line simply does not
appear. If you switch providers mid-session (via `/model` or similar),
the line is cleared as soon as you leave `minimax-cn` and re-fetched as
soon as you return. The manual `/minimax-quota` command also refuses to
run outside `minimax-cn` and notifies you of the active provider.

## What the bar shows

The Token Plan endpoint returns one entry per model bucket (`general`,
`video`, …). Per the upstream contract the **first entry** carries the
canonical quota state, so the bar surfaces only that:

| Field                | Meaning                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `MiniMax Token Plan` | Title label, dim color                                                                     |
| `5h 80%`             | 5-hour remaining percent, read from the first entry's `current_interval_remaining_percent` |
| `(3h12m)`            | `remains_time` of the first entry (milliseconds), formatted as minutes/hours/days          |
| `7d 30%`             | 7-day remaining percent, read from the first entry's `current_weekly_remaining_percent`    |
| `(4d6h)`             | `weekly_remains_time` of the first entry (milliseconds), formatted as minutes/hours/days   |

Groups are separated by a muted `·` so the line scans as
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

When the extension is active (provider is `minimax-cn`) and something
goes wrong it shows a dim placeholder so the footer never goes blank.
On any other provider the footer is left untouched (see **Activation**).

| Message                   | When                                                        |
| ------------------------- | ----------------------------------------------------------- |
| `minimax: loading…`       | Shown synchronously at session start (active provider only) |
| `minimax: no credentials` | `MINIMAX_TOKEN_PLAN_API_KEY` unset or empty                 |
| `minimax: no quota data`  | API returned an empty/unrecognized payload                  |
| `minimax: error`          | Any other failure (network, auth, parse, etc.)              |

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
