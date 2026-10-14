/**
 * Token rate for the pi TUI footer.
 *
 * Watches the assistant message stream and shows how fast the active model is
 * producing output tokens:
 *
 *   ⚡ 62 tok/s   live while the model streams, dimmed once the stream ends
 *
 * The rate is measured over a trailing window while tokens arrive, so it stays
 * readable between bursty deltas; there is no session history and no settled
 * average. This file only wires events to the controller in `./line.ts`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { TokenRateLine } from "./line.ts";

const USAGE = "token-rate: /token-rate";

export default function (pi: ExtensionAPI) {
  const line = new TokenRateLine();

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
    description: "Show or hide the tok/s line in the status bar",
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
