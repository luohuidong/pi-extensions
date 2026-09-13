/**
 * Auth resolution.
 *
 * Reads the static Token Plan API key from `~/.pi/agent/auth.json` under the
 * `minimax-cn` provider entry. We delegate to the host's
 * `readStoredCredential` helper so the path resolution (`~/.pi/agent`),
 * BOM stripping, and JSON-parse failure handling all match what pi itself
 * uses to authenticate model requests against this provider.
 *
 * Only Token Plan (`sk-cp-`) credentials are accepted: MiniMax ships two
 * static api-key flavours and they authorize different endpoints.
 * `sk-api-` (pay-as-you-go) keys only authorize `/account/query_balance`,
 * not `/v1/token_plan/remains`, so sending one to the quota endpoint would
 * just produce a generic upstream error. We surface that case as a
 * dedicated `wrong-type` so the caller can render an actionable
 * placeholder instead of a vague "error" line.
 *
 * `resolveAuth` accepts an optional `authPath` so tests can point at a
 * temp file without monkey-patching `os.homedir`; production callers pass
 * nothing and inherit the host's default `~/.pi/agent/auth.json`.
 */

import { readStoredCredential } from "@earendil-works/pi-coding-agent";

const PROVIDER_ID = "minimax-cn";
// Pay-as-you-go / API Secret Key prefix. Authorizes /account/query_balance,
// not the Token Plan endpoint — caught here rather than letting the upstream
// return a generic 401/404.
const PAYGO_PREFIX = "sk-api-";

export type AuthResolution =
  | { kind: "ok"; header: string }
  | { kind: "missing" }
  | { kind: "wrong-type" };

/**
 * Resolves the Token Plan auth state from `~/.pi/agent/auth.json`:
 *
 *   - `{ kind: "ok", header }` — the entry is a Token Plan api-key, ready to send
 *   - `{ kind: "wrong-type" }` — the entry is a pay-as-you-go api-key (`sk-api-`)
 *   - `{ kind: "missing" }` — no usable entry (missing provider, oauth type,
 *     empty key, file missing, JSON parse error)
 */
export function resolveAuth(authPath?: string): AuthResolution {
  const credential = readStoredCredential(PROVIDER_ID, authPath);
  if (credential?.type !== "api_key") return { kind: "missing" };
  const key = credential.key;
  if (!key || key.length === 0) return { kind: "missing" };
  if (key.startsWith(PAYGO_PREFIX)) return { kind: "wrong-type" };
  return { kind: "ok", header: `Bearer ${key}` };
}
