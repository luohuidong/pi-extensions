/**
 * MiniMax Token Plan quota status for the pi TUI footer.
 *
 * Reads the API key from the `MINIMAX_TOKEN_PLAN_API_KEY` environment
 * variable and queries the China-region Token Plan quota endpoint,
 * aggregating the per-model 5h and 7d windows into a single compact line
 * shown in the bottom status bar:
 *
 *   MiniMax Token Plan · 5h 80% (3h12m) · 7d 65% (4d6h)
 *
 * The line is refreshed on `session_start` and after every `agent_settled`
 * so the user always sees roughly current usage while pi runs.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { aggregate } from "./aggregate.ts";
import { createQuotaClient } from "./api.ts";
import { resolveAuthHeader } from "./auth.ts";
import { formatStatusLine } from "./format.ts";

const STATUS_KEY = "minimax-quota";

// The Token Plan endpoint is China-region only, and the quota is only
// meaningful when the active model belongs to that region. Any other
// provider would always render an error / no-data placeholder, so we
// stay invisible instead of polluting the footer.
const TARGET_PROVIDER = "minimax-cn";

const PLACEHOLDER_LOADING = "minimax: loading…";
const PLACEHOLDER_NO_CREDS = "minimax: no credentials";
const PLACEHOLDER_NO_DATA = "minimax: no quota data";
const PLACEHOLDER_ERROR = "minimax: error";

function isProviderActive(model: { provider: string } | undefined): boolean {
  return model?.provider === TARGET_PROVIDER;
}

export default function (pi: ExtensionAPI) {
  const quota = createQuotaClient();

  // Guard against stacking concurrent fetches when events fire back-to-back.
  let inflight = false;

  function clearStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(STATUS_KEY, undefined);
  }

  async function refresh(ctx: ExtensionContext): Promise<void> {
    if (inflight) return;
    if (!isProviderActive(ctx.model)) {
      // Provider switched away (or was never the right one) — drop any
      // stale line so the footer doesn't keep showing numbers that no
      // longer match the active model.
      clearStatus(ctx);
      return;
    }
    inflight = true;
    try {
      const authHeader = resolveAuthHeader();
      if (!authHeader) {
        ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", PLACEHOLDER_NO_CREDS));
        return;
      }

      const models = await quota.fetchQuota(authHeader);
      if (!models || models.length === 0) {
        ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", PLACEHOLDER_NO_DATA));
        return;
      }

      ctx.ui.setStatus(STATUS_KEY, formatStatusLine(ctx.ui.theme, aggregate(models)));
    } catch {
      ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", PLACEHOLDER_ERROR));
    } finally {
      inflight = false;
    }
  }

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    if (!isProviderActive(ctx.model)) {
      // Wrong provider — leave the footer untouched instead of showing a
      // permanent placeholder that would never resolve.
      return;
    }
    // Show a placeholder synchronously so the footer isn't empty during the
    // first fetch; the real line replaces it as soon as the request resolves.
    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", PLACEHOLDER_LOADING));
    void refresh(ctx);
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (!ctx.hasUI) return;
    if (!isProviderActive(ctx.model)) {
      // Nothing to refresh and nothing to clear — the line was never shown.
      return;
    }
    void refresh(ctx);
  });

  // React to mid-session provider / model switches so the bar appears
  // when the user picks MiniMax and disappears when they leave it.
  pi.on("model_select", (event, ctx) => {
    if (!ctx.hasUI) return;
    if (!isProviderActive(event.model)) {
      clearStatus(ctx);
      return;
    }
    void refresh(ctx);
  });

  // Manual refresh — handy when you want to verify the bar reflects the
  // current API state, or after rotating the API key.
  pi.registerCommand("minimax-quota", {
    description: "Refresh the MiniMax quota line in the status bar",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("minimax-quota: no UI in this mode", "warning");
        return;
      }
      if (!isProviderActive(ctx.model)) {
        ctx.ui.notify(
          `minimax-quota: provider is "${ctx.model?.provider ?? "unknown"}", expected "${TARGET_PROVIDER}"`,
          "warning",
        );
        return;
      }
      await refresh(ctx);
    },
  });
}
