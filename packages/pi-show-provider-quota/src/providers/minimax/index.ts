/**
 * MiniMax Token Plan provider adapter.
 *
 * Bundles the vendor's endpoint, credential rules, payload normalization, and
 * rendering behind the shared `QuotaProvider` contract. The core controller
 * only ever calls `loadingText` and `render`.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { QuotaProvider, RenderResult } from "../../core/types.ts";
import { aggregate } from "./aggregate.ts";
import { fetchQuota } from "./api.ts";
import { resolveAuth } from "./auth.ts";
import { formatDetail, formatStatusLine } from "./format.ts";

// The Token Plan endpoint is China-region only, so only models from this
// provider can reach it.
const PROVIDER_ID = "minimax-cn";

function dim(ctx: ExtensionContext, text: string): string {
  return ctx.ui.theme.fg("dim", text);
}

export const minimax: QuotaProvider = {
  id: PROVIDER_ID,
  providerIds: [PROVIDER_ID],

  loadingText: (ctx) => dim(ctx, "MiniMax Token Plan: loading…"),

  async render(ctx): Promise<RenderResult> {
    const auth = resolveAuth();
    if (auth.kind === "missing") {
      return { text: dim(ctx, "MiniMax Token Plan: no credentials") };
    }
    if (auth.kind === "wrong-type") {
      // `sk-api-` (pay-as-you-go) authorizes /account/query_balance, not the
      // Token Plan endpoint.
      return {
        text: dim(ctx, "MiniMax Token Plan: need Token Plan key (sk-cp-…)"),
      };
    }

    const models = await fetchQuota(auth.header);
    if (!models || models.length === 0) {
      return { text: dim(ctx, "MiniMax Token Plan: no quota data") };
    }

    const quota = aggregate(models);
    return {
      text: formatStatusLine(ctx.ui.theme, quota),
      detail: formatDetail(quota),
    };
  },
};
