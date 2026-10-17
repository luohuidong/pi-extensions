/**
 * Subscription quota for the active model provider, in the pi TUI footer.
 *
 * Shows whichever vendor the active model belongs to, using that vendor's own
 * look and window set. Providers are registered in `./providers/index.ts`;
 * this file only wires the extension's events to the shared controller and
 * exposes the manual `/show-provider-quota` command.
 *
 * The line is refreshed on `session_start` and after every `agent_settled`,
 * plus once when the active provider crosses a vendor boundary. There is no
 * polling: refreshes are throttled to one fetch per provider per 30 seconds.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { QuotaLine } from "./core/line.ts";
import {
  classifyModelSwitch,
  PROVIDERS,
  providerFor,
} from "./providers/index.ts";

export default function (pi: ExtensionAPI) {
  const line = new QuotaLine(PROVIDERS);

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    line.activate(ctx);
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (!ctx.hasUI) return;
    void line.refresh(ctx);
  });

  // React to provider switches: fetch once when entering a supported vendor,
  // clear when leaving, and do nothing when both sides belong to the same
  // vendor (switching between two models of one vendor must not spend a
  // request or blank the line).
  pi.on("model_select", (event, ctx) => {
    if (!ctx.hasUI) return;
    const transition = classifyModelSwitch(
      PROVIDERS,
      event.previousModel?.provider,
      event.model?.provider,
    );
    if (transition === "noop") return;
    line.activate(ctx);
  });

  // Manual refresh plus a labelled breakdown. The status line is positional
  // and vendor-specific, so this is where the window names live; refreshing
  // only when the cache is stale means a fresh command prints instantly.
  pi.registerCommand("show-provider-quota", {
    description:
      "Show the active provider's quota breakdown and refresh the status bar",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("show-provider-quota: no UI in this mode", "warning");
        return;
      }
      const provider = providerFor(PROVIDERS, ctx.model?.provider);
      if (!provider) {
        ctx.ui.notify(
          `show-provider-quota: provider is "${ctx.model?.provider ?? "unknown"}", which has no quota support`,
          "warning",
        );
        return;
      }

      if (line.isFetching(ctx)) {
        // Join the request that is already running instead of firing another.
        ctx.ui.notify("show-provider-quota: querying quota…", "info");
        await line.refresh(ctx);
      } else if (!line.isFresh(ctx)) {
        await line.refresh(ctx);
      }

      const detail = line.getDetail(ctx);
      if (detail === undefined) {
        // The status bar already carries the specific reason.
        ctx.ui.notify(
          "show-provider-quota: no quota data — see the status bar for the reason",
          "warning",
        );
        return;
      }
      ctx.ui.notify(detail, "info");
    },
  });
}
