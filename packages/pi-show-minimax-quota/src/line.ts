/**
 * Quota line controller.
 *
 * Owns the status-bar entry: writes it, refreshes it on demand, and dedupes
 * concurrent refreshes fired by back-to-back events. Every string the line
 * can show — the loading placeholder, the four failure-mode placeholders,
 * and the aggregated line itself — lives next to the controller that picks
 * between them.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { aggregate } from "./aggregate.ts";
import { fetchQuota } from "./api.ts";
import { resolveAuth } from "./auth.ts";
import { formatStatusLine } from "./format.ts";

// UI identifier for the status row this extension owns. The string is part
// of the public surface — other extensions or the host may look the row up
// by key — so the value is locked even though the constant itself is local.
const STATUS_KEY = "minimax-quota";

// The Token Plan endpoint is China-region only, and the quota is only
// meaningful when the active model belongs to that region. Any other
// provider would always render an error / no-data placeholder, so we stay
// invisible instead of polluting the footer.
export const TARGET_PROVIDER = "minimax-cn";

export function isProviderActive(
  model: { provider: string } | undefined,
): boolean {
  return model?.provider === TARGET_PROVIDER;
}

// All placeholders are dim-styled so they don't get misread as high-quota.
const LOADING = "MiniMax Token Plan: loading…";
const NO_CREDS = "MiniMax Token Plan: no credentials";
// `sk-api-` (pay-as-you-go) authorizes /account/query_balance, not Token Plan.
const WRONG_TYPE = "MiniMax Token Plan: need Token Plan key (sk-cp-…)";
const NO_DATA = "MiniMax Token Plan: no quota data";
const ERROR = "MiniMax Token Plan: error";

/**
 * Renders and refreshes the quota line in the status bar. One instance per
 * extension load. The `#inflight` guard is a single boolean — fine because
 * pi events are delivered sequentially on a single loop.
 */
export class QuotaLine {
  // Guard against stacking concurrent fetches when events fire back-to-back.
  #inflight = false;

  /** Drop the line entirely — e.g. the active provider switched away. */
  clear(ctx: ExtensionContext): void {
    this.#write(ctx, undefined);
  }

  /** Show the synchronous loading placeholder; refresh() replaces it on resolve. */
  showLoading(ctx: ExtensionContext): void {
    this.#write(ctx, ctx.ui.theme.fg("dim", LOADING));
  }

  /**
   * Fetch the latest quota and write the resulting line. No-op if a refresh
   * is already in flight, or if the active provider isn't ours.
   */
  async refresh(ctx: ExtensionContext): Promise<void> {
    if (this.#inflight) return;
    // Provider switched away — drop any stale line so the footer doesn't
    // keep showing numbers that no longer match the active model.
    if (!isProviderActive(ctx.model)) {
      this.clear(ctx);
      return;
    }
    this.#inflight = true;
    try {
      this.#write(ctx, await this.#render(ctx));
    } catch {
      this.#write(ctx, ctx.ui.theme.fg("dim", ERROR));
    } finally {
      this.#inflight = false;
    }
  }

  async #render(ctx: ExtensionContext): Promise<string> {
    const auth = resolveAuth();
    if (auth.kind === "missing") return ctx.ui.theme.fg("dim", NO_CREDS);
    if (auth.kind === "wrong-type") return ctx.ui.theme.fg("dim", WRONG_TYPE);

    const models = await fetchQuota(auth.header);
    if (!models || models.length === 0) return ctx.ui.theme.fg("dim", NO_DATA);

    return formatStatusLine(ctx.ui.theme, aggregate(models));
  }

  #write(ctx: ExtensionContext, text: string | undefined): void {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(STATUS_KEY, text);
  }
}
