/**
 * MiniMax Token Plan quota status for the pi TUI footer.
 *
 * Reads the API key from `~/.pi/agent/auth.json` (the `minimax-cn` provider
 * entry, via the host's `readStoredCredential`) and queries the China-region
 * Token Plan quota endpoint,
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
import { fetchQuota } from "./api.ts";
import { resolveAuth } from "./auth.ts";
import { formatStatusLine } from "./format.ts";

const STATUS_KEY = "minimax-quota";

// The Token Plan endpoint is China-region only, and the quota is only
// meaningful when the active model belongs to that region. Any other
// provider would always render an error / no-data placeholder, so we
// stay invisible instead of polluting the footer.
const TARGET_PROVIDER = "minimax-cn";

const PLACEHOLDER_LOADING = "MiniMax Token Plan: loading…";
const PLACEHOLDER_NO_CREDS = "MiniMax Token Plan: no credentials";
const PLACEHOLDER_WRONG_TYPE = "MiniMax Token Plan: need Token Plan key (sk-cp-…)";
const PLACEHOLDER_NO_DATA = "MiniMax Token Plan: no quota data";
const PLACEHOLDER_ERROR = "MiniMax Token Plan: error";

function isProviderActive(model: { provider: string } | undefined): boolean {
  return model?.provider === TARGET_PROVIDER;
}

export default function (pi: ExtensionAPI) {
  // Guard against stacking concurrent fetches when events fire back-to-back.
  let inflight = false;

  function clearStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(STATUS_KEY, undefined);
  }

  function setPlaceholder(ctx: ExtensionContext, text: string): void {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", text));
  }

  function setLine(ctx: ExtensionContext, line: string): void {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(STATUS_KEY, line);
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
      const auth = resolveAuth();
      if (auth.kind === "missing") {
        setPlaceholder(ctx, PLACEHOLDER_NO_CREDS);
        return;
      }
      if (auth.kind === "wrong-type") {
        // `sk-api-` (pay-as-you-go) keys authorize /account/query_balance, not
        // the Token Plan endpoint. Render a dedicated placeholder so the user
        // can see the prefix they need instead of a generic upstream error.
        setPlaceholder(ctx, PLACEHOLDER_WRONG_TYPE);
        return;
      }

      const models = await fetchQuota(auth.header);
      if (!models || models.length === 0) {
        setPlaceholder(ctx, PLACEHOLDER_NO_DATA);
        return;
      }

      setLine(ctx, formatStatusLine(ctx.ui.theme, aggregate(models)));
    } catch {
      setPlaceholder(ctx, PLACEHOLDER_ERROR);
    } finally {
      inflight = false;
    }
  }

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    // Wrong provider — leave the footer untouched instead of showing a
    // permanent placeholder that would never resolve.
    if (!isProviderActive(ctx.model)) return;
    // Show a placeholder synchronously so the footer isn't empty during the
    // first fetch; the real line replaces it as soon as the request resolves.
    setPlaceholder(ctx, PLACEHOLDER_LOADING);
    void refresh(ctx);
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (!ctx.hasUI) return;
    // Nothing to refresh and nothing to clear — the line was never shown.
    if (!isProviderActive(ctx.model)) return;
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
    // Match session_start: show the placeholder synchronously so the
    // footer isn't blank while the first fetch is in flight (up to
    // the 5s fetch timeout in api.ts). refresh() replaces it on resolve.
    setPlaceholder(ctx, PLACEHOLDER_LOADING);
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
