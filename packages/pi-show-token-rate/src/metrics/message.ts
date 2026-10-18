/**
 * Message-level predicates shared by the metrics.
 */

import type { AssistantMessage } from "./types.ts";

/**
 * Stop reasons that end a response without finishing it. pi still emits
 * `message_end` for these, but what they leave behind is not a reading the
 * model sustained — dropping it keeps the frozen row honest.
 */
export function isDroppedResponse(message: AssistantMessage): boolean {
  return message.stopReason === "aborted" || message.stopReason === "error";
}
