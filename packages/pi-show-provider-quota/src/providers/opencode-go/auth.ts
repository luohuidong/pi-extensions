/**
 * Auth resolution for the OpenCode Go usage endpoint.
 *
 * The endpoint accepts the same API key the provider uses for inference, so we
 * ask pi's own model registry first — that path already covers the
 * `auth.json` entry, the `OPENCODE_API_KEY` environment variable, and any
 * runtime key installed by another extension. Only if the registry has nothing
 * do we fall back to a direct `~/.pi/agent/auth.json` read via the host's
 * `readStoredCredential`.
 *
 * We intentionally do not read opencode's own `auth.json`
 * (`~/.local/share/opencode/auth.json`): that file belongs to a different
 * tool, and pi already has the credential.
 *
 * `resolveAuth` accepts an optional `authPath` so tests can point at a temp
 * file without monkey-patching `os.homedir`; production callers pass nothing
 * and inherit the host's default `~/.pi/agent/auth.json`.
 */

import { readStoredCredential } from "@earendil-works/pi-coding-agent";

export const PROVIDER_ID = "opencode-go";

export type AuthResolution =
  | { kind: "ok"; apiKey: string }
  | { kind: "missing" };

/**
 * The slice of pi's `ModelRegistry` we need. Narrowing it keeps the test double
 * trivial to build:
 *
 *   `await ctx.modelRegistry.getApiKeyForProvider("opencode-go")`
 */
export interface ApiKeyLookup {
  getApiKeyForProvider(provider: string): Promise<string | undefined>;
}

/**
 * Resolves the API key used against the usage endpoint:
 *
 *   1. `modelRegistry.getApiKeyForProvider("opencode-go")`
 *   2. the `opencode-go` `api_key` entry in `~/.pi/agent/auth.json`
 *
 * A `Credential` of type `oauth` is not usable here; it degrades to `missing`
 * rather than being sent to the endpoint.
 */
export async function resolveAuth(
  modelRegistry: ApiKeyLookup,
  authPath?: string,
): Promise<AuthResolution> {
  try {
    const resolved = await modelRegistry.getApiKeyForProvider(PROVIDER_ID);
    if (typeof resolved === "string" && resolved.length > 0) {
      return { kind: "ok", apiKey: resolved };
    }
  } catch {
    // Registry unavailable — fall through to the auth.json read.
  }

  const credential = readStoredCredential(PROVIDER_ID, authPath);
  if (credential?.type !== "api_key") return { kind: "missing" };
  const key = credential.key;
  if (!key || key.length === 0) return { kind: "missing" };
  return { kind: "ok", apiKey: key };
}
