# Show Token Rate For Pi Coding Agent

A [pi](https://github.com/earendil-works/pi) extension that shows how fast the
active model is streaming output tokens, and how long it takes to start, in the
bottom status bar of the TUI.

```plaintext
TPS 62 tok/s · TTFT 1.2s
```

While the model streams, `TPS` is a **live** trailing-window rate and `TTFT` is
how long the current response took to produce its first token. When the stream
ends, both readings keep their values but are dimmed. There is no session
history and no settled average.

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

| Segment  | Meaning                                                                   |
| -------- | ------------------------------------------------------------------------- |
| `TPS`    | Marker for the throughput reading, always `dim`                           |
| `62`     | Output tokens per second, live while streaming, kept once the stream ends |
| `tok/s`  | Unit, `dim`                                                               |
| `TTFT`   | Marker for the latency reading, always `dim`                              |
| `1.2s`   | Time to the first token of the current response, kept once it ends        |
| `ms`/`s` | Unit, `dim`, chosen by magnitude                                          |

Only the numbers carry colour; the `TPS` / `TTFT` markers are always `dim`, and
the two segments are joined by a `dim` `·`. TPS comes first.

While the model streams, the numbers are coloured by their own scale:

| TPS            | Colour |
| -------------- | ------ |
| above 50 tok/s | green  |
| 10–50 tok/s    | yellow |
| below 10 tok/s | red    |

| TTFT     | Colour |
| -------- | ------ |
| below 1s | green  |
| 1–3s     | yellow |
| above 3s | red    |

Each colour is chosen from the number actually displayed, so a value and its
colour never disagree (e.g. a displayed `50` tok/s is yellow, `51` is green).
Once the stream ends both numbers are dimmed, and the last readings stay on the
row.

The row is blank at session start. Once a response starts, each slot holds a
reading or a placeholder: the first token of a stream cannot be timed until it
arrives, and the TPS character estimate waits for a full second of history
before it is believed. A slot with no usable reading yet carries the previous
value over, dimmed, rather than blanking; before anything has ever been
measured it shows `TPS — tok/s` / `TTFT — ms`. A response that ends without a
reading — an empty reply, or an aborted one — leaves the previous readings in
place.

## How TPS is measured

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
  otherwise the estimate answers. A provider count that repeats a constant,
  stops being reported, or resets cannot freeze the live number — its window
  expires like any other.
- **Freeze, don't average.** When `message_end` arrives the current window value
  is captured and the trackers are dropped; the bar keeps showing that reading,
  dimmed.

## How TTFT is measured

- **Request to first token.** The anchor is the assistant message's own
  `timestamp`, which pi sets when it opens the response stream, before the
  request is built and sent. The reading is the gap to the first token-bearing
  stream event, so it covers network, queueing and prefill, but not the local
  prompt assembly that precedes the request.
- **Every response gets its own reading.** A tool-calling turn issues several
  model requests, and each one overwrites the number, so the bar always shows
  the most recent request's latency. There is no per-turn average.
- **Adaptive unit.** The latency is rounded to the nearest millisecond first;
  below one second the value is shown in whole milliseconds (`840ms`), because
  that is where the interesting differences are, and from one second up it is
  shown with one decimal of seconds (`1.2s`).
- **Freeze and drop.** A completed response (including one truncated by the
  output limit) freezes its reading, dimmed. A response that is aborted or
  errors out keeps the previous reading, as does one that never produced a
  token.
- **What "first token" means.** The earliest of a `text_start` /
  `thinking_start` / `toolcall_start`, or a non-empty `text_delta` /
  `thinking_delta` / `toolcall_delta`. An empty delta is stream scaffolding, not
  output.
- **Plausibility guard.** A reading beyond five minutes is treated as a
  wall-clock artifact and refused rather than printed.

One caveat: pi retries some provider failures internally, and that retry
backoff is invisible to extensions. It is included in the reading. Agent-level
restarts are not — each restarted request gets a fresh anchor.

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

TTFT does not depend on usage at all: it only needs the request stamp pi already
puts on every assistant message and the arrival of the first stream event, so it
works the same way on every provider.

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

| Command       | Effect                                 |
| ------------- | -------------------------------------- |
| `/token-rate` | Toggle the whole status line on or off |

## Development

Requires the workspace's Node version (`>=26`): the suite is plain
`node --test`, which relies on Node running `.ts` files through its built-in
type stripping.

```bash
pnpm install
pnpm test          # node --test
pnpm typecheck     # tsc --noEmit
```

The suite covers each metric in isolation (the character estimator, the trailing
window's monotonicity, pruning and credit guards, the two-scale tracker, the
TTFT anchor and first-token detection), the exact status-line strings, and the
controller's composition, throttling, freezing and toggle behaviour. Two
windowing tests are differential: they replay thousands of irregularly-spaced
observations and check `rate(now)` against the trailing-window definition at
every step, so the incremental pruning cannot drift from it. The suite drives an
injected clock, so no test depends on wall-clock timing, and it uses a stub
theme instead of the real ANSI palette.

## License

MIT
