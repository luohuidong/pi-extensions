/**
 * Token Plan quota HTTP client.
 *
 * Hits the China-region `/v1/token_plan/remains` endpoint only — the global
 * endpoint does not expose this surface. Returns the per-model
 * `model_remains` array, or `null` on any transport failure so callers can
 * render a graceful placeholder instead of throwing.
 *
 * Field semantics (used by `aggregate.ts`):
 *   - `current_interval_remaining_percent` — server-precomputed 5h percent remaining
 *   - `remains_time`                        — ms until the 5h window resets
 *   - `current_weekly_remaining_percent`    — server-precomputed 7d percent remaining
 *   - `weekly_remains_time`                 — ms until the 7d window resets
 *
 * The upstream payload contains a number of additional fields (`model_name`,
 * `*_status`, `weekly_boost_permille`, etc.) that we deliberately do not
 * surface here — they're informational and not consumed by the status line.
 * Mirroring the full schema would couple this extension to upstream naming
 * churn with no benefit; we narrow to the four fields we actually read and
 * let `aggregate()`'s `readPositive` zero out anything missing or malformed.
 *
 * The boundary cast `as QuotaResponse` matches the convention used by
 * mmx-cli's `requestJson<T>`: trust the documented shape, treat anything
 * off-shape as a transport failure (caught by the outer try/catch).
 */

export interface QuotaModelRemain {
  /** Milliseconds until the 5h window resets. Required. */
  remains_time: number;
  /** Milliseconds until the 7d window resets. Required. */
  weekly_remains_time: number;
  /** Server-reported 5h percent remaining (0–100). Optional in payload. */
  current_interval_remaining_percent?: number | null;
  /** Server-reported 7d percent remaining (0–100). Optional in payload. */
  current_weekly_remaining_percent?: number | null;
}

interface QuotaResponse {
  model_remains: QuotaModelRemain[];
}

export async function fetchQuota(
  authHeader: string,
): Promise<QuotaModelRemain[] | null> {
  let res: Response;
  try {
    res = await fetch("https://api.minimaxi.com/v1/token_plan/remains", {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  try {
    const body = (await res.json()) as QuotaResponse;
    return body.model_remains;
  } catch {
    return null;
  }
}
