/**
 * OpenCode Go subscription quota for the pi TUI footer.
 *
 * Shows the three usage windows the Go plan meters — the 5-hour rolling
 * window, the weekly window, and the monthly window — as used
 * percentages, read from the official usage endpoint with the same API key
 * the provider uses for inference:
 *
 *   Go·1%(3h28m)·6%(4d7h)·3%(28d20h)
 *
 * The three groups are positional — rolling, weekly, monthly — and
 * unlabelled; see `./format.ts`.
 *
 * The line is refreshed on `session_start` and after every `agent_settled`,
 * plus once when the active provider crosses into `opencode-go`. There is
 * no polling: refreshes are throttled to one fetch per 30 seconds.
 *
 * All state-mutating logic lives in `./line.ts`; this file just wires the
 * extension's events to the controller.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatDetail } from "./format.ts";
import {
  classifyModelSwitch,
  isProviderActive,
  QuotaLine,
  TARGET_PROVIDER,
} from "./line.ts";

export default function (pi: ExtensionAPI) {
  const line = new QuotaLine();

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    void line.refresh(ctx);
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (!ctx.hasUI) return;
    void line.refresh(ctx);
  });

  // React to provider switches: fetch once when entering `opencode-go`,
  // clear when leaving it, and do nothing at all when the two sides belong
  // to the same provider (switching between two Go models must not spend a
  // request or blank the line).
  pi.on("model_select", (event, ctx) => {
    if (!ctx.hasUI) return;
    switch (classifyModelSwitch(event.previousModel, event.model)) {
      case "leave":
        line.clear(ctx);
        return;
      case "enter":
        void line.refresh(ctx);
        return;
      default:
        return;
    }
  });

  // Manual refresh plus a labelled breakdown. The status line is positional
  // and unlabelled, so this is where the window names live; refreshing first
  // means the breakdown is never older than the line next to it.
  pi.registerCommand("opencode-go-quota", {
    description:
      "Show the OpenCode Go quota breakdown and refresh the status bar",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("opencode-go-quota: no UI in this mode", "warning");
        return;
      }
      if (!isProviderActive(ctx.model)) {
        ctx.ui.notify(
          `opencode-go-quota: provider is "${ctx.model?.provider ?? "unknown"}", expected "${TARGET_PROVIDER}"`,
          "warning",
        );
        return;
      }
      await line.refreshNow(ctx);

      const snapshot = line.getSnapshot();
      if (!snapshot) {
        // The status bar already carries the specific reason.
        ctx.ui.notify(
          "opencode-go-quota: no usage data — see the status bar for the reason",
          "warning",
        );
        return;
      }
      ctx.ui.notify(formatDetail(snapshot.quota, snapshot.fetchedAt), "info");
    },
  });
}
