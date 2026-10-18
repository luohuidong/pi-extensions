/**
 * Assistant message / stream event factories for tests.
 *
 * The shapes come from pi's extension event types (`MessageStartEvent`,
 * `MessageUpdateEvent`, `MessageEndEvent`), so the controller is exercised
 * with the same structures the host delivers at runtime.
 */

import type {
  MessageEndEvent,
  MessageStartEvent,
  MessageUpdateEvent,
} from "@earendil-works/pi-coding-agent";

export type AssistantMessage = Extract<
  MessageEndEvent["message"],
  { role: "assistant" }
>;

export function makeAssistantMessage(
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    usage: {
      input: 1200,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 1200,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
    ...overrides,
  };
}

/** Partial message as a provider would report it mid-stream. */
function withOutput(
  message: AssistantMessage,
  output: number,
): AssistantMessage {
  return makeAssistantMessage({
    ...message,
    usage: {
      ...message.usage,
      output,
      totalTokens: message.usage.input + output,
    },
  });
}

/**
 * A delta stream event; `output` is the provider-reported token count and
 * `type` picks which content block the text belongs to.
 */
function makeDeltaUpdate(
  type: "text_delta" | "thinking_delta" | "toolcall_delta",
  message: AssistantMessage,
  output: number,
  text: string,
): MessageUpdateEvent {
  const partial = withOutput(message, output);
  return {
    type: "message_update",
    message: partial,
    assistantMessageEvent: { type, contentIndex: 0, delta: text, partial },
  };
}

/** A content-block open event, which carries no text. */
function makeStartUpdate(
  type: "text_start" | "thinking_start" | "toolcall_start",
  message: AssistantMessage,
  output: number,
): MessageUpdateEvent {
  const partial = withOutput(message, output);
  return {
    type: "message_update",
    message: partial,
    assistantMessageEvent: { type, contentIndex: 0, partial },
  };
}

/** A `text_delta` stream event. */
export function makeTextUpdate(
  message: AssistantMessage,
  output: number,
  text = "token ",
): MessageUpdateEvent {
  return makeDeltaUpdate("text_delta", message, output, text);
}

/** A `thinking_delta` stream event. */
export function makeThinkingUpdate(
  message: AssistantMessage,
  output: number,
  text = "thinking ",
): MessageUpdateEvent {
  return makeDeltaUpdate("thinking_delta", message, output, text);
}

/** A `toolcall_delta` stream event; `text` is the raw JSON chunk. */
export function makeToolcallUpdate(
  message: AssistantMessage,
  output: number,
  text: string,
): MessageUpdateEvent {
  return makeDeltaUpdate("toolcall_delta", message, output, text);
}

/** A `text_start` content-block open. */
export function makeTextStart(
  message: AssistantMessage,
  output: number,
): MessageUpdateEvent {
  return makeStartUpdate("text_start", message, output);
}

/** A `thinking_start` content-block open. */
export function makeThinkingStart(
  message: AssistantMessage,
  output: number,
): MessageUpdateEvent {
  return makeStartUpdate("thinking_start", message, output);
}

/** A `toolcall_start` content-block open. */
export function makeToolcallStart(
  message: AssistantMessage,
  output: number,
): MessageUpdateEvent {
  return makeStartUpdate("toolcall_start", message, output);
}

export function makeMessageStart(message: AssistantMessage): MessageStartEvent {
  return { type: "message_start", message };
}

export function makeMessageEnd(
  message: AssistantMessage,
  output?: number,
): MessageEndEvent {
  return {
    type: "message_end",
    message: output === undefined ? message : withOutput(message, output),
  };
}
