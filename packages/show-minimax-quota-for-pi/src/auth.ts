/**
 * Auth header resolution.
 *
 * Reads the static Token Plan API key from the `MINIMAX_TOKEN_PLAN_API_KEY`
 * environment variable. Users set the variable directly (e.g. via their
 * shell rc or a tooling-loaded `.env`).
 *
 * API keys are expected to start with `sk-cp-`; we don't enforce that here
 * since the upstream endpoint is the source of truth. Empty or unset
 * variables yield `null` so the caller can render the "no credentials"
 * placeholder.
 */

/**
 * Returns a ready-to-use `Authorization` header value, or `null` if the
 * `MINIMAX_TOKEN_PLAN_API_KEY` environment variable is missing or empty.
 */
export function resolveAuthHeader(): string | null {
  const key = process.env.MINIMAX_TOKEN_PLAN_API_KEY;
  if (!key || key.length === 0) return null;
  return `Bearer ${key}`;
}
