/**
 * Token rate for the pi TUI footer.
 *
 * Watches the assistant message stream and shows how fast the active model is
 * producing output tokens, and how long it took to start:
 *
 *   TPS 62 tok/s · TTFT 1.2s
 *
 * The rate is measured over a trailing window while tokens arrive, so it stays
 * readable between bursty deltas; there is no session history and no settled
 * average. TTFT is the gap from the request to the first token of the current
 * response. This file only wires events to the controller in `./line.ts`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { MetricsLine } from "./line.ts";

const USAGE = "token-rate: /token-rate";

export default function (pi: ExtensionAPI) {
  const line = new MetricsLine();

  pi.on("session_start", (_event, ctx) => {
    line.start(ctx);
  });

  pi.on("message_start", (event, ctx) => {
    line.onMessageStart(ctx, event.message);
  });

  pi.on("message_update", (event, ctx) => {
    line.onUpdate(ctx, event);
  });

  pi.on("message_end", (event, ctx) => {
    line.onMessageEnd(ctx, event.message);
  });

  pi.registerCommand("token-rate", {
    description: "Show or hide the TPS/TTFT status line",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("token-rate: no UI in this mode", "warning");
        return;
      }
      if (args.trim() !== "") {
        ctx.ui.notify(USAGE, "warning");
        return;
      }

      ctx.ui.notify(
        line.toggle(ctx)
          ? "token-rate: status line on"
          : "token-rate: status line off",
        "info",
      );
    },
  });
}
