# Show Token Rate For Pi Coding Agent

A [pi](https://github.com/earendil-works/pi) extension that shows how fast the
active model is streaming output tokens, in the bottom status bar of the TUI.

```plaintext
⚡ 62 tok/s
```

While the model streams, the number is a **live** trailing-window rate, coloured
by speed. When the stream ends the last reading keeps its value but is dimmed.
There is no session history and no settled average — the line only ever reports
a rate.

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

| Segment | Meaning                                                                            |
| ------- | ---------------------------------------------------------------------------------- |
| `⚡`    | Marker: green while streaming, `dim` once the stream ends                          |
| `62`    | Output tokens per second, rounded, live while streaming, kept once the stream ends |
| `tok/s` | Unit, dim                                                                          |

While the model streams, the rate is coloured by speed:

| Rate           | Colour |
| -------------- | ------ |
| above 50 tok/s | green  |
| 10–50 tok/s    | yellow |
| below 10 tok/s | red    |

The colour is chosen from the number actually displayed, so the label and its
colour never disagree (e.g. `50` is yellow, `51` is green). The `⚡` marker is
green for as long as the model is streaming — regardless of the rate's own
colour — so the bar reads as live at a glance; once the stream ends the marker
goes back to `dim`, and the last reading is dimmed too.

The row starts blank and stays blank until a response produces a measurable
rate: the first token of a stream cannot be timed on its own, and the character
estimate waits for a full second of history before it is believed. The `⚡`
marker still turns green as soon as a response starts streaming; until a rate is
measurable the row carries the previous reading over, dimmed (or shows
`⚡ tok/s —` when nothing has been measured yet). A response that ends without a
measurable rate — an empty reply, or an aborted one — leaves the previous
reading in place.

## How the rate is measured

- **Streaming only.** The rate is measured while the model produces tokens, and
  nothing is settled afterwards. A response that is aborted or errors out is not
  frozen at all — the bar keeps the previous reading.
- **Trailing window while streaming.** Live updates average the last 3 seconds
  of streaming. Providers emit deltas in bursts and stall while writing a
  thinking block or tool-call JSON, so a per-event rate would flicker between 0
  and several hundred tok/s.
- **Two scales, two windows.** A provider's cumulative output-token count and
  the character estimate are different units, so each gets its own trailing
  window. Provider usage wins while its window is moving, fresh and plausible;
  otherwise the estimate answers. A provider count that repeats a
  constant, stops being reported, or resets cannot freeze the live number — its
  window expires like any other.
- **Freeze, don't average.** When `message_end` arrives the current window value
  is captured and the trackers are dropped; the bar keeps showing that reading,
  dimmed.

## Accuracy

Not every provider reports token usage while a response is streaming:

- When the provider reports a cumulative count that keeps advancing mid-stream,
  the extension uses it — the number is exact.
- When it does not — OpenAI-compatible endpoints typically send usage only on
  the final chunk, and Anthropic reports a small count at the start and only
  updates it in a terminal event pi does not surface — the live number falls
  back to a **character estimate**: CJK, kana, Hangul, and fullwidth punctuation
  count as roughly one token each, text as one per four characters, and
  tool-call argument JSON as one per two and a half — JSON keys and punctuation
  tokenize denser than prose. The bar does not label which scale answered: the
  estimate exists only to keep the number moving while the provider stays quiet.
- The two scales are measured in parallel, and a window whose newest reading has
  fallen outside the trailing 3 seconds counts as unmeasurable, so a provider
  count that stops advancing — a repeated constant, a dropped field, or a reset
  counter — hands the row back to the estimate until it moves again.

### Buffered tool calls

Characters say when text **arrived**, not when it was generated. Endpoints that
do not stream tool-call arguments token by token deliver a whole command — or a
whole file — in one delta, and crediting that at face value would print four
digits of tok/s. An estimated window therefore credits each interval with at
most **twice the pace it is already running at** (a floor of 100 tok/s covers
the first second, before the window has a pace of its own) and stays silent
until it has a full second of history; provider counts are never credited that
way. The ceiling follows the window's own **raw** pace, so a genuinely fast
stream still reaches its real rate within a second or two instead of being held
near the floor.

A reading above **5,000 tok/s** — faster than any production model streams today
— is refused for the same reason: providers that buffer a whole tool call and
flush it in one burst hand the extension thousands of tokens a few milliseconds
apart, and printing that window would show tens of thousands of tok/s. The line
keeps its previous value instead.

The wide/narrow weighting is a heuristic, not a tokenizer, so mixed scripts can
still read a few percent low or high.

## Slash command

| Command       | Effect                           |
| ------------- | -------------------------------- |
| `/token-rate` | Toggle the status line on or off |

## Development

Requires the workspace's Node version (`>=26`): the suite is plain
`node --test`, which relies on Node running `.ts` files through its built-in
type stripping.

```bash
pnpm install
pnpm test          # node --test
pnpm typecheck     # tsc --noEmit
```

Tests cover the character estimator, the trailing window (monotonicity, pruning,
credit guards), the two-scale tracker, the exact status-line strings, and the
controller's throttling, freezing and toggle behavior. Two windowing tests are
differential: they replay thousands of irregularly-spaced observations and check
`rate(now)` against the trailing-window definition at every step, so the
incremental pruning cannot drift from it. The suite drives an injected clock, so
no test depends on wall-clock timing, and it uses a stub theme instead of the
real ANSI palette.

## License

MIT
