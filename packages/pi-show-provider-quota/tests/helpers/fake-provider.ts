/**
 * Configurable provider double for core controller tests.
 *
 * It records how many times `render` ran so tests can assert the throttle and
 * the per-provider in-flight guard, and it lets each test supply its own
 * resolved or pending `render`.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { RenderResult } from "../../src/core/types.ts";

export interface FakeProvider {
  id: string;
  providerIds: string[];
  calls: number;
  loadingText(ctx: ExtensionContext): string;
  render(ctx: ExtensionContext, now: number): Promise<RenderResult>;
}

export function makeFakeProvider(options: {
  id: string;
  providerIds?: string[];
  render?: (ctx: ExtensionContext, now: number) => Promise<RenderResult>;
}): FakeProvider {
  const inner =
    options.render ??
    (async (): Promise<RenderResult> => ({
      text: `${options.id}: ok`,
      detail: `${options.id}: detail`,
    }));

  const provider: FakeProvider = {
    id: options.id,
    providerIds: options.providerIds ?? [options.id],
    calls: 0,
    loadingText: (ctx) => ctx.ui.theme.fg("dim", `${options.id}: loading…`),
    async render(ctx, now) {
      provider.calls += 1;
      return await inner(ctx, now);
    },
  };
  return provider;
}

/** A promise plus its resolver, for driving "response arrives later" cases. */
export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
