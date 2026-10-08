# Show Token Rate For Pi Coding Agent

A [pi](https://github.com/earendil-works/pi) extension that shows how fast the
active model is streaming output tokens, in the bottom status bar of the TUI.

```plaintext
⚡ 62 tok/s
```

While the model streams, the number is a **live** trailing-window rate. Once the
response settles, the line keeps the last measured rate plus a session average:

```plaintext
⚡ 62 tok/s · avg 55
```

The line is provider-agnostic: it measures whatever model is active, so there is
no activation condition and nothing to configure per provider.

## Install

Install from npm:

```bash
pi install npm:pi-show-token-rate
```

For a one-off test run without installing:

```bash
pi -e npm:pi-show-token-rate
```

## What the bar shows

| Segment    | Meaning                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| `⚡`       | Label, always dim                                                                                             |
| `~`        | Present only when the number is estimated rather than provider-reported (see **Accuracy** below)              |
| `62`       | Output tokens per second: live while streaming, the last response's rate once settled, rounded to whole tok/s |
| `tok/s`    | Unit, dim                                                                                                     |
| `· avg 55` | Duration-weighted average across completed responses; hidden until a second response finishes                 |

The rate is colored green at **50 tok/s** and above, yellow at **20 tok/s** and
above, and dim below that — a slow model reads as quiet, not as an error.

The row stays blank until a response produces a measurable rate: the first
token of a stream cannot be timed on its own. A response that ends without a
measurable rate — an empty reply, or `/token-rate reset` — shows
`⚡ tok/s —` instead.

## How the rate is measured

- **Generation window only.** The clock starts at the first streamed token, not
  at the request. Prompt prefill and time-to-first-token are excluded, so the
  number answers "how fast does this model generate", not "how long did the
  request take".
- **Trailing window while streaming.** Live updates average the last 3 seconds
  of streaming. Providers emit deltas in bursts and stall while writing a
  thinking block or tool-call JSON, so a per-event rate would flicker between 0
  and several hundred tok/s.
- **Whole-response average once settled.** When `message_end` arrives, the
  response is scored over its full generation window and folded into the
  session average.

## Accuracy

Not every provider reports token usage while a response is streaming:

- When `usage.output` is available (Anthropic and other providers that stream
  usage), the extension uses it — the number is exact.
- When it is not (OpenAI-compatible endpoints typically send usage only on the
  final chunk), the extension estimates tokens as **streamed characters ÷ 4**,
  the same heuristic pi itself uses for context estimation. Estimated numbers
  are marked with a leading `~` so they are never mistaken for reported ones.
- If usage only starts arriving halfway through a stream, the live number keeps
  its `~` and its scale until the response ends — mixing a reported count into
  a chars ÷ 4 window would spike the rate. The settled number is the exact
  one, and the `~` disappears with it.

The same fallback is used to keep counting when a tool call is streamed as
JSON, so tool-heavy turns still measure sensibly.

## Slash command

| Command             | Effect                                                                      |
| ------------------- | --------------------------------------------------------------------------- |
| `/token-rate`       | Toggle the status line on or off                                            |
| `/token-rate stats` | Notify with the last / average / peak rate and how many responses were seen |
| `/token-rate reset` | Drop collected statistics, keeping the current visibility                   |

`stats` output looks like:

```plaintext
last 62 tok/s · avg 55 tok/s · peak 91 tok/s · 12 responses · 3 estimated
```

## Development

Requires the workspace's Node version (`>=26`): the suite is plain
`node --test`, which relies on Node running `.ts` files through its built-in
type stripping.

```bash
pnpm install
pnpm test          # node --test
pnpm typecheck     # tsc --noEmit
```

Tests cover the character estimator, the tracker (windowing, monotonicity,
pruning), the summary math, the exact status-line strings, and the controller's
throttling and toggle behavior. The suite drives an injected clock, so no test
depends on wall-clock timing, and it uses a stub theme instead of the real ANSI
palette.

## License

MIT
