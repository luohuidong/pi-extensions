/**
 * Token rate for the pi TUI footer.
 *
 * Watches the assistant message stream and shows how fast the active model
 * is producing output tokens:
 *
 *   ⚡ 62 tok/s            live, while the model streams
 *   ⚡ 62 tok/s · avg 55   the last response plus the session average
 *
 * The rate is measured over the generation window (first token → last token)
 * so prompt prefill does not drag it down, and the live number is a
 * trailing-window average so it stays readable between bursty deltas.
 *
 * This file only wires events to the controller in `./line.ts`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { formatSummary } from "./format.ts";
import { TokenRateLine } from "./line.ts";

const USAGE = "token-rate: /token-rate [stats|reset]";

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
      const sub = args.trim().toLowerCase();

      if (sub === "stats") {
        ctx.ui.notify(`token-rate: ${formatSummary(line.summary())}`, "info");
        return;
      }
      if (!ctx.hasUI) {
        ctx.ui.notify("token-rate: no UI in this mode", "warning");
        return;
      }
      if (sub === "reset") {
        line.reset(ctx);
        ctx.ui.notify("token-rate: statistics cleared", "info");
        return;
      }
      if (sub !== "") {
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
