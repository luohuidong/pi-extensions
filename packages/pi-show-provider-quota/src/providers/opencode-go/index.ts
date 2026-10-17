/**
 * OpenCode Go provider adapter.
 *
 * Bundles the vendor's endpoint, credential rules, payload normalization, and
 * rendering behind the shared `QuotaProvider` contract. The core controller
 * only ever calls `loadingText` and `render`.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { QuotaProvider, RenderResult } from "../../core/types.ts";
import { aggregate } from "./aggregate.ts";
import { fetchUsage } from "./api.ts";
import { resolveAuth } from "./auth.ts";
import { formatDetail, formatStatusLine } from "./format.ts";

const PROVIDER_ID = "opencode-go";

function dim(ctx: ExtensionContext, text: string): string {
  return ctx.ui.theme.fg("dim", text);
}

export const opencodeGo: QuotaProvider = {
  id: PROVIDER_ID,
  providerIds: [PROVIDER_ID],

  loadingText: (ctx) => dim(ctx, "OpenCode Go: loading…"),

  async render(ctx, now): Promise<RenderResult> {
    const auth = await resolveAuth(ctx.modelRegistry);
    if (auth.kind === "missing") {
      return { text: dim(ctx, "OpenCode Go: no credentials") };
    }

    const result = await fetchUsage(auth.apiKey);
    if (result.kind === "unauthorized") {
      return { text: dim(ctx, "OpenCode Go: invalid key") };
    }
    if (result.kind === "no-subscription") {
      // 403 — valid key, but its workspace has no Go subscription (Zen and Go
      // share one workspace key, so a Zen-only key lands here).
      return { text: dim(ctx, "OpenCode Go: no Go subscription") };
    }
    if (result.kind === "error") {
      return { text: dim(ctx, "OpenCode Go: error") };
    }

    const quota = aggregate(result.body);
    if (!quota) {
      return { text: dim(ctx, "OpenCode Go: no quota data") };
    }

    return {
      text: formatStatusLine(ctx.ui.theme, quota, now),
      detail: formatDetail(quota, now),
    };
  },
};
