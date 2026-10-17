/**
 * Provider lookup — a registry in the plain sense: a list of named entries
 * plus a lookup by name. No class, no container, no registration side effects.
 *
 * Note this is not the host's `ctx.modelRegistry`; that object belongs to pi
 * and resolves API keys per provider. This lookup only answers "which adapter
 * handles this model provider?".
 */

import type { QuotaProvider } from "./types.ts";

export function providerFor(
  providers: readonly QuotaProvider[],
  providerId: string | undefined,
): QuotaProvider | undefined {
  if (!providerId) return undefined;
  return providers.find((p) => p.providerIds.includes(providerId));
}

/**
 * Classifies a `model_select` transition by *adapter* identity rather than by
 * provider string: two ids that map to the same adapter are the same account,
 * so switching between them must not clear the line or spend a request.
 */
export function classifyModelSwitch(
  providers: readonly QuotaProvider[],
  previousId: string | undefined,
  nextId: string | undefined,
): "enter" | "leave" | "noop" {
  const previous = providerFor(providers, previousId);
  const next = providerFor(providers, nextId);
  if (next === previous) return "noop";
  if (!next) return "leave";
  return "enter";
}
