# Show OpenCode Go Quota For Pi Coding Agent

A [pi](https://github.com/earendil-works/pi) extension that shows the current
[OpenCode Go](https://opencode.ai/docs/go/) subscription quota in the bottom
status bar of the TUI.

The line renders as

```plaintext
Go·1%(3h28m)·6%(4d7h)·3%(28d20h)
```

and is refreshed when pi starts a session (`session_start`) and after every
settled agent run (`agent_settled`). Usage is read from the official
endpoint — `https://opencode.ai/zen/go/v1/usage` — with the same API key the
provider uses for inference. No console session cookie and no workspace id
are involved.

## Install

Install from npm:

```bash
pi install npm:pi-show-opencode-go-quota
```

For a one-off test run without installing:

```bash
pi -e npm:pi-show-opencode-go-quota
```

## Prerequisites

- `pi` installed globally
- An OpenCode Go subscription and its API key. Inside a pi session, run
  `/login` and pick `opencode-go`, or set `OPENCODE_API_KEY`. pi keeps the
  key in `~/.pi/agent/auth.json`; this extension resolves it through pi's
  own model registry first and only falls back to reading that file
  directly, so an API key supplied purely via the environment works too.
- A key from a workspace **without** a Go subscription (a Zen
  pay-as-you-go key, for example) is not usable here — the endpoint answers
  `403` and the bar says so. Zen and Go share one workspace key, so this is
  a common mix-up.

## Activation

The line only appears when the active model's provider is `opencode-go`.
Any other provider leaves the footer untouched — there is no "disabled" or
"unsupported" placeholder, the line simply does not appear.

Switching providers mid-session is handled as follows:

| Transition                                  | Behavior                         |
| ------------------------------------------- | -------------------------------- |
| another provider → `opencode-go`            | fetch and show the line          |
| `opencode-go` → another provider            | clear the line                   |
| `opencode-go` → another `opencode-go` model | nothing (no request, no flicker) |

Switching between two Go models — GLM to Kimi, say — deliberately does not
re-query: the quota is account-wide, so the numbers cannot have changed.

## What the bar shows

The line is 32 columns wide and packs three groups separated by `·`:

```plaintext
Go·1%(3h28m)·6%(4d7h)·3%(28d20h)
│  │  │        │  │        │  │
│  │  └────────┘  └────────┘  └─ monthly: 3% used, resets in 28d20h
│  └─ weekly: 6% used, resets in 4d7h
└──── rolling: 1% used, resets in 3h28m
```

**The groups are positional and carry no labels.** The order is always
rolling → weekly → monthly. This is deliberate — labels cost roughly 20
columns — so the order is part of the line's contract. Run
`/opencode-go-quota` for the same numbers with the window names spelled out.

The endpoint meters three windows per account, all shown as **used**
percentages, matching the OpenCode dashboard convention:

| Group | Window             | Percent source          | Countdown source         |
| ----- | ------------------ | ----------------------- | ------------------------ |
| 1     | rolling (~5 hours) | `usage.rolling.percent` | `usage.rolling.resetsAt` |
| 2     | weekly (~7 days)   | `usage.weekly.percent`  | `usage.weekly.resetsAt`  |
| 3     | monthly (~30 days) | `usage.monthly.percent` | `usage.monthly.resetsAt` |

Per OpenCode's plan definition, the weekly allowance is 50% of the monthly
allowance and the 5-hour allowance is 20% of it.

Notes on the numbers:

- **These are used percentages, not remaining ones.** 12% means 12% of the
  window is consumed. This is the opposite convention from this workspace's
  `pi-show-minimax-quota`, which reports MiniMax's remaining percentage —
  the two vendors define their dashboards differently and both extensions
  follow their own vendor.
- **Values are shown exactly as the API returns them.** No re-derivation,
  no rounding, no reconciling against the OpenCode dashboard. The API
  floors its percentage while the dashboard rounds, so the two can differ
  by up to one point; the API is treated as the source of truth here.
- **Colors track remaining headroom**: under 70% used is green, 70–89% is
  yellow, 90% and above is red.
- **Countdowns use minute precision**: `3h28m` keeps its minutes, `28d20h`
  has dropped them. A window with no usable `resetsAt` omits the
  parentheses entirely, shrinking the line to `Go·1%·6%·3%`.

## Refresh behavior

There is no polling. The line is fetched on `session_start`, on
`agent_settled`, once when the provider crosses into `opencode-go`, and on
demand via `/opencode-go-quota`. Two consequences are worth knowing:

- **Refreshes are throttled to one per 30 seconds.** A turn that settles
  inside that window keeps the previous numbers; the next settled run or a
  manual refresh catches up.
- **The countdown is a snapshot.** Since the line is only rewritten when a
  refresh happens, an idle session keeps showing the numbers and remaining
  time from the last fetch rather than ticking down.

## Manual refresh and breakdown

Inside a pi session, run `/opencode-go-quota` to refresh and print the
labelled breakdown:

```plaintext
OpenCode Go usage (used %)
  Rolling 1% (3h28m)
  Weekly  6% (4d7h)
  Monthly 3% (28d20h)
```

Unlike the automatic triggers this bypasses the 30-second throttle — handy
after rotating the API key, or when you want to confirm which group is
which without consulting this document. Outside `opencode-go` the command
refuses to run and tells you which provider is active; if the fetch failed
it says so instead of printing stale numbers.

## Status messages

When the extension is active and something goes wrong it shows a dim
placeholder so the footer never goes blank. On any other provider the
footer is left untouched (see **Activation**).

| Message                           | When                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `OpenCode Go: loading…`           | Shown while the first request of a refresh is in flight                                                              |
| `OpenCode Go: no credentials`     | No usable `opencode-go` API key (registry empty, missing entry, oauth credential, empty key, unreadable `auth.json`) |
| `OpenCode Go: invalid key`        | HTTP `401` — the API key was rejected                                                                                |
| `OpenCode Go: no Go subscription` | HTTP `403` — valid key, but its workspace has no Go plan                                                             |
| `OpenCode Go: no quota data`      | `200`, but none of the three windows carried a usable percentage                                                     |
| `OpenCode Go: error`              | Any other failure: network, timeout, other non-2xx status, or an unparseable body                                    |

## Development

```bash
pnpm install
pnpm test          # node --test
pnpm typecheck     # tsc --noEmit
```

Tests cover payload aggregation, the HTTP client's status mapping, key
resolution, the throttle and provider-switch decisions, and the full
`formatStatusLine` output. They run against stub `fetch` implementations and
a stub theme, so no network access or real ANSI palette is involved.

See [`AGENTS.md`](./AGENTS.md) for the package's internal contracts.

## License

MIT
