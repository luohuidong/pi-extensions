/**
 * Extension wiring: which events are registered, and what `/token-rate` does.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import extension from "../src/index.ts";
import { expect } from "./helpers/expect.ts";
import {
  makeAssistantMessage,
  makeMessageEnd,
  makeTextUpdate,
} from "./helpers/messages.ts";
import { theme } from "./helpers/theme.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

function makePi(): {
  pi: ExtensionAPI;
  handlers: Map<string, Handler>;
  commands: Map<
    string,
    {
      handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
    }
  >;
  notifications: string[];
  statuses: (string | undefined)[];
  ctx: ExtensionContext;
} {
  const handlers = new Map<string, Handler>();
  const commands = new Map<
    string,
    {
      handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
    }
  >();
  const notifications: string[] = [];
  const statuses: (string | undefined)[] = [];

  const ctx = {
    hasUI: true,
    ui: {
      theme,
      notify: (message: string) => notifications.push(message),
      setStatus: (_key: string, text: string | undefined) =>
        statuses.push(text),
    },
  } as unknown as ExtensionContext;

  const pi = {
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    registerCommand: (
      name: string,
      options: {
        handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
      },
    ) => commands.set(name, options),
  } as unknown as ExtensionAPI;

  return { pi, handlers, commands, notifications, statuses, ctx };
}

describe("extension", () => {
  it("registers the message lifecycle and the slash command", () => {
    const { pi, handlers, commands } = makePi();
    extension(pi);

    expect([...handlers.keys()].sort()).toEqual([
      "message_end",
      "message_start",
      "message_update",
      "session_start",
    ]);
    expect([...commands.keys()]).toEqual(["token-rate"]);
  });

  it("routes the message lifecycle into the status row", (t) => {
    // The controller captures the clock when it is constructed, so the mock has
    // to be in place before the extension builds it.
    t.mock.timers.enable({ apis: ["Date"], now: 1_000 });

    const { pi, handlers, statuses, ctx } = makePi();
    extension(pi);

    const start = handlers.get("message_start");
    const update = handlers.get("message_update");
    const end = handlers.get("message_end");
    assert.ok(start && update && end);

    const message = makeAssistantMessage();
    start({ type: "message_start", message }, ctx);
    update(makeTextUpdate(message, 10), ctx);
    t.mock.timers.tick(100);
    update(makeTextUpdate(message, 20), ctx);
    end(
      { type: "message_end", message: makeMessageEnd(message, 30).message },
      ctx,
    );

    const painted = statuses.filter((text) => text !== undefined);
    assert.ok(painted.length > 0, "expected the row to be painted");
    expect(painted[painted.length - 1]).toContain("tok/s");
  });

  it("toggles from the command and rejects arguments", async () => {
    const { pi, commands, notifications, ctx } = makePi();
    extension(pi);
    const command = commands.get("token-rate");
    assert.ok(command);
    const commandCtx = ctx as unknown as ExtensionCommandContext;

    await command.handler("", commandCtx);
    expect(notifications.pop()).toBe("token-rate: status line off");

    await command.handler("", commandCtx);
    expect(notifications.pop()).toBe("token-rate: status line on");

    await command.handler("nope", commandCtx);
    expect(notifications.pop()).toBe("token-rate: /token-rate");
  });
});
