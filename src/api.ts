/**
 * Token Plan quota HTTP client.
 *
 * Hits the China-region endpoint only (the global endpoint is not part of
 * the supported Token Plan surface). Returns the per-model `model_remains`
 * array, or `null` on any transport / shape failure so callers can render
 * a graceful placeholder instead of throwing.
 */

const CN_BASE_URL = "https://api.minimaxi.com";
const QUOTA_PATH = "/v1/token_plan/remains";
const QUOTA_TIMEOUT_MS = 5_000;

export interface QuotaModelRemain {
  remains_time: number;
  weekly_remains_time: number;
  current_interval_remaining_percent?: number | null;
  current_weekly_remaining_percent?: number | null;
}

interface QuotaResponse {
  model_remains?: unknown;
}

export interface QuotaClient {
  fetchQuota(authHeader: string): Promise<QuotaModelRemain[] | null>;
}

export function createQuotaClient(): QuotaClient {
  return {
    async fetchQuota(authHeader: string): Promise<QuotaModelRemain[] | null> {
      let res: Response;
      try {
        res = await fetch(`${CN_BASE_URL}${QUOTA_PATH}`, {
          method: "GET",
          headers: { Authorization: authHeader },
          signal: AbortSignal.timeout(QUOTA_TIMEOUT_MS),
        });
      } catch {
        return null;
      }
      if (!res.ok) return null;

      let body: QuotaResponse;
      try {
        body = (await res.json()) as QuotaResponse;
      } catch {
        return null;
      }
      if (!Array.isArray(body.model_remains)) return null;
      return body.model_remains as QuotaModelRemain[];
    },
  };
}
