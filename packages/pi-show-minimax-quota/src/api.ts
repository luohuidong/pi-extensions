/**
 * Token Plan quota HTTP client.
 *
 * Hits the China-region `/v1/token_plan/remains` endpoint only — the global
 * endpoint does not expose this surface. Returns the per-model
 * `model_remains` array, or `null` on any transport / shape failure so
 * callers can render a graceful placeholder instead of throwing.
 */

export interface QuotaModelRemain {
  remains_time: number;
  weekly_remains_time: number;
  current_interval_remaining_percent?: number | null;
  current_weekly_remaining_percent?: number | null;
}

interface QuotaResponse {
  model_remains?: unknown;
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
    return Array.isArray(body.model_remains)
      ? (body.model_remains as QuotaModelRemain[])
      : null;
  } catch {
    return null;
  }
}
