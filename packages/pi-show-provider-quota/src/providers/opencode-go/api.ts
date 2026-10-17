/**
 * OpenCode Go usage HTTP client.
 *
 * Hits the official OpenCode Go usage endpoint, which — unlike the dashboard
 * scrape — only needs the subscription's own API key as a Bearer token. No
 * workspace id and no console session cookie.
 *
 *   GET https://opencode.ai/zen/go/v1/usage
 *   Authorization: Bearer <API_KEY>
 *   ->
 *   {
 *     "usage": {
 *       "rolling": { "status": "ok", "percent": 0,  "resetsAt": "2026-10-14T13:21:30.000Z" },
 *       "weekly":  { "status": "ok", "percent": 6,  "resetsAt": "2026-10-19T00:00:00.000Z" },
 *       "monthly": { "status": "ok", "percent": 3,  "resetsAt": "2026-11-12T12:55:55.000Z" }
 *     }
 *   }
 *
 * `percent` is the *used* percentage (0–100), already floored by the server.
 *
 * In the upstream opencode repository this route is only a thin proxy
 * (`proxyInference`) to the inference service, so the response schema is owned
 * by that service and can change without any change in the console app.
 * Because of that we deliberately declare only the fields we read and ignore
 * everything else.
 *
 * The endpoint is hard-coded on purpose: `opencode-go` models are served from
 * several base URLs (`https://opencode.ai/inference/go`,
 * `https://opencode.ai/inference/go/v1`, `https://opencode.ai/zen`), none of
 * which is the quota endpoint, so deriving it from the model would be wrong.
 */

const ENDPOINT = "https://opencode.ai/zen/go/v1/usage";
// Measured against a real account: the first request of a session (cold
// connection, possibly through a proxy) took ~6.3s while subsequent ones
// settled at ~0.4s. A 5s budget produced spurious `error` placeholders on
// session start, so the ceiling is 10s. The throttle means this only ever
// delays one request.
const TIMEOUT_MS = 10_000;

/** One quota window as returned by the endpoint. */
export interface RawWindow {
  /** Upstream status marker (observed value: `"ok"`). Informational only. */
  status?: string;
  /** Used percentage, 0–100. The value the status bar displays verbatim. */
  percent?: number | null;
  /** ISO-8601 timestamp at which the window resets. */
  resetsAt?: string | null;
}

export interface RawUsage {
  usage?: {
    rolling?: RawWindow;
    weekly?: RawWindow;
    monthly?: RawWindow;
  };
}

export type FetchResult =
  | { kind: "ok"; body: RawUsage }
  | { kind: "unauthorized" }
  | { kind: "no-subscription" }
  | { kind: "error" };

/**
 * Fetches the OpenCode Go usage windows.
 *
 * Never throws: every transport / parsing failure is mapped onto a
 * `FetchResult` variant so callers can render a placeholder instead of
 * crashing the status bar.
 *
 * `fetchImpl` is injectable for tests; production callers use the global
 * `fetch`.
 */
export async function fetchUsage(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchResult> {
  let res: Response;
  try {
    res = await fetchImpl(ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { kind: "error" };
  }

  // 401 means the key itself was rejected. 403 means the key is valid but its
  // workspace has no Go subscription: Zen and Go share the same workspace key,
  // so a Zen-only key lands here. Keeping the two apart lets the status bar
  // tell the user which one to fix.
  if (res.status === 401) return { kind: "unauthorized" };
  if (res.status === 403) return { kind: "no-subscription" };
  if (!res.ok) return { kind: "error" };

  try {
    const body = (await res.json()) as RawUsage;
    return { kind: "ok", body };
  } catch {
    return { kind: "error" };
  }
}
