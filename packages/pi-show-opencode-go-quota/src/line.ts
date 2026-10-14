/**
 * Quota line controller.
 *
 * Owns the status-bar entry: gates on the active provider, throttles
 * refreshes, dedupes concurrent fetches, and picks between the aggregated
 * line and the failure placeholders. Every string the line can show lives
 * next to the controller that chooses it.
 *
 * Refresh is event-driven only — `session_start` and `agent_settled`, plus
 * a provider-boundary model switch and the manual command. There is no
 * timer and no polling, which also means the reset countdown is a snapshot
 * taken at fetch time and stays put until the next refresh.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { type AggregatedQuota, aggregate } from "./aggregate.ts";
import { fetchUsage } from "./api.ts";
import { resolveAuth } from "./auth.ts";
import { formatStatusLine } from "./format.ts";

// UI identifier for the status row this extension owns. The string is part
// of the public surface — the footer's `getExtensionStatuses()` exposes it
// and other extensions may look the row up by key — so the value is locked
// even though the constant itself is local.
const STATUS_KEY = "opencode-go-quota";

// Only models from this provider can reach the Go quota endpoint. Any
// other provider would always render a placeholder, so we stay invisible
// instead of polluting the footer.
export const TARGET_PROVIDER = "opencode-go";

// Minimum gap between two fetches. `agent_settled` fires once per turn, and
// the quota windows move slowly, so re-querying within half a minute is
// pure upstream traffic. The manual command bypasses this.
export const THROTTLE_MS = 30_000;

// All placeholders are dim-styled so they don't get misread as a quota
// readout.
const LOADING = "OpenCode Go: loading…";
const NO_CREDS = "OpenCode Go: no credentials";
// 401 — the API key itself was rejected.
const INVALID_KEY = "OpenCode Go: invalid key";
// 403 — valid key, but its workspace has no Go subscription (Zen and Go
// share one workspace key, so a Zen-only key lands here).
const NO_SUBSCRIPTION = "OpenCode Go: no Go subscription";
const NO_DATA = "OpenCode Go: no quota data";
const ERROR = "OpenCode Go: error";

export function isProviderActive(
  model: { provider: string } | undefined,
): boolean {
  return model?.provider === TARGET_PROVIDER;
}

/**
 * Classifies a `model_select` transition.
 *
 * Only a provider *boundary* crossing is actionable. Switching between two
 * `opencode-go` models (GLM → Kimi, say) must not clear the line or spend a
 * request.
 */
export function classifyModelSwitch(
  previous: { provider: string } | undefined,
  next: { provider: string } | undefined,
): "enter" | "leave" | "noop" {
  const wasActive = isProviderActive(previous);
  const isActive = isProviderActive(next);
  if (isActive && !wasActive) return "enter";
  if (wasActive && !isActive) return "leave";
  return "noop";
}

/**
 * Decides whether a refresh should be skipped.
 *
 * `hasContent` means "the status bar currently holds something this
 * extension wrote" — a data frame *or* a placeholder frame. Clearing the
 * line resets it, so leaving and returning within the throttle window still
 * re-fetches instead of leaving the footer empty. It also means a failed
 * attempt still counts as content, so retries stay throttled rather than
 * hammering the endpoint.
 *
 * `lastFetchAt === 0` (nothing fetched yet this session) never throttles.
 */
export function shouldThrottle(
  lastFetchAt: number,
  now: number,
  hasContent: boolean,
): boolean {
  if (!hasContent) return false;
  if (lastFetchAt <= 0) return false;
  return now - lastFetchAt < THROTTLE_MS;
}

/**
 * Last successfully parsed quota, together with the fetch time its
 * countdowns are relative to. The `/opencode-go-quota` command renders its
 * labelled breakdown from this instead of re-implementing the fetch.
 */
export interface QuotaSnapshot {
  quota: AggregatedQuota;
  fetchedAt: number;
}

/** What a single render produced: the text, plus the data behind it. */
interface RenderResult {
  text: string;
  quota?: AggregatedQuota;
}

/**
 * Renders and refreshes the quota line. One instance per extension load.
 * The `#inflight` guard is a single boolean — fine because pi events are
 * delivered sequentially on a single loop.
 */
export class QuotaLine {
  // Guard against stacking concurrent fetches when events fire back-to-back.
  #inflight = false;
  // Start time of the last fetch attempt; drives shouldThrottle().
  #lastFetchAt = 0;
  // Whether the status bar currently holds anything we wrote.
  #hasContent = false;
  // Bumped by clear(). A fetch that started before a clear must not write
  // its result afterwards — switching providers mid-request would otherwise
  // resurrect a line for a provider we already left.
  #generation = 0;
  // Last good data, or undefined after a failure / clear.
  #snapshot: QuotaSnapshot | undefined;

  /**
   * Last good quota data, or `undefined` when the last attempt failed or the
   * line was cleared. Read by the `/opencode-go-quota` detail view.
   */
  getSnapshot(): QuotaSnapshot | undefined {
    return this.#snapshot;
  }

  /** Drop the line entirely — e.g. the active provider switched away. */
  clear(ctx: ExtensionContext): void {
    this.#generation++;
    this.#hasContent = false;
    this.#snapshot = undefined;
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(STATUS_KEY, undefined);
  }

  /** Throttled refresh, used by every automatic trigger. */
  async refresh(
    ctx: ExtensionContext,
    now: number = Date.now(),
  ): Promise<void> {
    await this.#run(ctx, now, false);
  }

  /** Forced refresh that ignores the throttle — used by the manual command. */
  async refreshNow(
    ctx: ExtensionContext,
    now: number = Date.now(),
  ): Promise<void> {
    await this.#run(ctx, now, true);
  }

  async #run(
    ctx: ExtensionContext,
    now: number,
    bypassThrottle: boolean,
  ): Promise<void> {
    if (this.#inflight) return;

    // Provider switched away — drop any stale line so the footer doesn't
    // keep showing numbers that no longer match the active model.
    if (!isProviderActive(ctx.model)) {
      this.clear(ctx);
      return;
    }

    // Throttled: keep the current content untouched. Deliberately checked
    // before writing the loading placeholder so nothing flickers.
    if (
      !bypassThrottle &&
      shouldThrottle(this.#lastFetchAt, now, this.#hasContent)
    ) {
      return;
    }

    this.#inflight = true;
    const generation = this.#generation;
    try {
      this.#write(ctx, ctx.ui.theme.fg("dim", LOADING));
      const rendered = await this.#render(ctx, now);
      // The provider switched away while the request was in flight — the
      // line was cleared on purpose, so don't bring it back.
      if (generation !== this.#generation) return;
      // A failure clears the snapshot too: the README promises the bar never
      // keeps stale numbers, and the detail view follows the same rule.
      this.#snapshot = rendered.quota
        ? { quota: rendered.quota, fetchedAt: now }
        : undefined;
      this.#write(ctx, rendered.text);
    } catch {
      if (generation !== this.#generation) return;
      this.#snapshot = undefined;
      this.#write(ctx, ctx.ui.theme.fg("dim", ERROR));
    } finally {
      // Recorded even for a discarded result: the request was spent.
      this.#lastFetchAt = now;
      this.#inflight = false;
    }
  }

  async #render(ctx: ExtensionContext, now: number): Promise<RenderResult> {
    const auth = await resolveAuth(ctx.modelRegistry);
    if (auth.kind === "missing") {
      return { text: ctx.ui.theme.fg("dim", NO_CREDS) };
    }

    const result = await fetchUsage(auth.apiKey);
    if (result.kind === "unauthorized") {
      return { text: ctx.ui.theme.fg("dim", INVALID_KEY) };
    }
    if (result.kind === "no-subscription") {
      return { text: ctx.ui.theme.fg("dim", NO_SUBSCRIPTION) };
    }
    if (result.kind === "error") {
      return { text: ctx.ui.theme.fg("dim", ERROR) };
    }

    const quota = aggregate(result.body);
    if (!quota) return { text: ctx.ui.theme.fg("dim", NO_DATA) };

    return { text: formatStatusLine(ctx.ui.theme, quota, now), quota };
  }

  #write(ctx: ExtensionContext, text: string | undefined): void {
    if (!ctx.hasUI) return;
    if (text === undefined) {
      this.#hasContent = false;
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    this.#hasContent = true;
    ctx.ui.setStatus(STATUS_KEY, text);
  }
}
