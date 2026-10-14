/**
 * Character → token estimation.
 *
 * The fallback used whenever a provider does not report a usable
 * `usage.output` while a response streams: OpenAI-compatible endpoints send
 * usage only on the final chunk, and Anthropic reports a constant count until
 * a terminal event that pi never surfaces as a stream event.
 *
 * The stream only offers characters, so they are charged the way a tokenizer
 * roughly would, in two buckets:
 *
 *   - **text** (answer and thinking) — wide characters (CJK ideographs and
 *     kana, Hangul, fullwidth punctuation) cost about one token each, narrow
 *     ones about one per {@link CHARS_PER_TOKEN}.
 *   - **tool JSON** — tool-call argument JSON tokenizes denser than prose
 *     (keys, quotes, braces, slashes, short paths), so it is charged one token
 *     per {@link TOOL_CHARS_PER_TOKEN} narrow characters. Wide characters
 *     inside JSON still cost about one token each.
 *
 * Everything here is pure: no clock, no windows, no terminal. The caller
 * accumulates a {@link CharCount} across a response and converts it once per
 * delta with {@link estimateTokens}.
 */

/**
 * Narrow characters per token for prose. Matches pi's own `estimateTokens`
 * heuristic (content length ÷ 4).
 */
const CHARS_PER_TOKEN = 4;

/**
 * Narrow characters per token for tool-call argument JSON. Measured over real
 * streams at ~2.4; charging JSON at the prose rate made tool-heavy turns read
 * noticeably low.
 */
const TOOL_CHARS_PER_TOKEN = 2.5;

/**
 * Characters a tokenizer charges roughly one token for: CJK ideographs and
 * kana, Hangul, and the fullwidth punctuation that travels with them.
 */
const WIDE_CHAR =
  /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}]/u;

/** Raw character totals of some streamed text, split by how it is charged. */
export interface CharCount {
  /** Answer and thinking characters (UTF-16 units). */
  textChars: number;
  /** How many of the text characters are wide (see {@link countWideChars}). */
  textWideChars: number;
  /** Tool-call argument JSON characters (UTF-16 units). */
  toolChars: number;
  /** How many of the tool-call characters are wide. */
  toolWideChars: number;
}

/** An empty accumulator. */
export function emptyCharCount(): CharCount {
  return { textChars: 0, textWideChars: 0, toolChars: 0, toolWideChars: 0 };
}

/** How many characters of `text` are wide. */
export function countWideChars(text: string): number {
  let count = 0;
  for (const char of text) {
    if (WIDE_CHAR.test(char)) count += 1;
  }
  return count;
}

/**
 * Token estimate for `chars` characters, `wideChars` of which are wide.
 * `narrowCharsPerToken` is 4 for prose or {@link TOOL_CHARS_PER_TOKEN} for
 * JSON. Non-finite or non-positive input becomes 0, so a malformed event can
 * never poison the rate with NaN.
 */
export function estimateTokensFromChars(
  chars: number,
  wideChars = 0,
  narrowCharsPerToken = CHARS_PER_TOKEN,
): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  const wide = Math.min(Math.max(wideChars, 0), chars);
  return Math.ceil(wide + (chars - wide) / narrowCharsPerToken);
}

/** Token estimate for a whole response: text/thinking plus tool-call JSON. */
export function estimateTokens(count: CharCount): number {
  return (
    estimateTokensFromChars(count.textChars, count.textWideChars) +
    estimateTokensFromChars(
      count.toolChars,
      count.toolWideChars,
      TOOL_CHARS_PER_TOKEN,
    )
  );
}
