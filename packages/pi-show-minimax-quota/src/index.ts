/**
 * MiniMax Token Plan quota status for the pi TUI footer.
 *
 * Reads the API key from `~/.pi/agent/auth.json` (the `minimax-cn` provider
 * entry, via the host's `readStoredCredential`) and queries the China-region
 * Token Plan quota endpoint, aggregating the per-model 5h and 7d windows
 * into a single compact line shown in the bottom status bar:
 *
 *   MiniMax Token Plan · 5h 80% (3h12m) · 7d 65% (4d6h)
 *
 * The line is refreshed on `session_start` and after every `agent_settled`
 * so the user always sees roughly current usage while pi runs.
 *
 * All state-mutating logic lives in `./line.ts`; this file just wires the
 * extension's events to the controller.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isProviderActive, QuotaLine, TARGET_PROVIDER } from "./line.ts";

export default function (pi: ExtensionAPI) {
  const line = new QuotaLine();

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI || !isProviderActive(ctx.model)) return;
    // Show a placeholder synchronously so the footer isn't empty during
    // the first fetch; the real line replaces it as soon as the request resolves.
    line.showLoading(ctx);
    void line.refresh(ctx);
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (!ctx.hasUI || !isProviderActive(ctx.model)) return;
    void line.refresh(ctx);
  });

  // React to mid-session provider / model switches so the bar appears
  // when the user picks MiniMax and disappears when they leave it.
  pi.on("model_select", (event, ctx) => {
    if (!ctx.hasUI) return;
    if (!isProviderActive(event.model)) {
      line.clear(ctx);
      return;
    }
    // Match session_start: show the placeholder synchronously so the
    // footer isn't blank while the first fetch is in flight (up to
    // the 5s fetch timeout in api.ts). refresh() replaces it on resolve.
    line.showLoading(ctx);
    void line.refresh(ctx);
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
      await line.refresh(ctx);
    },
  });
}
