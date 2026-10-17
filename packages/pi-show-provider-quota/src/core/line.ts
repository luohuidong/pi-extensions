/**
 * Quota line controller.
 *
 * Owns the single status-bar row for whichever provider is active. State is
 * kept per provider in a `Map`, and there is exactly one write path — `paint`,
 * which always reads the *currently active* provider's entry. That invariant
 * is what makes switching safe: a fetch that started for the previous provider
 * can land in its own map slot without ever touching the row that now belongs
 * to a different provider. No generation counter is needed for that.
 *
 * Refresh is event-driven only: `session_start`, `agent_settled`, a
 * provider-boundary model switch, and the manual command. There is no timer,
 * so the reset countdown is a snapshot taken at fetch time and stays put until
 * the next refresh.
 *
 * All user-visible strings come from the provider (`loadingText`, and the
 * placeholders inside `render`); the core owns no vendor vocabulary.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { providerFor } from "./lookup.ts";
import type { QuotaProvider } from "./types.ts";

/** UI identifier for the status row this extension owns. */
export const STATUS_KEY = "provider-quota";

// Minimum gap between two fetches. `agent_settled` fires once per turn and the
// quota windows move slowly, so re-querying within half a minute is pure
// upstream traffic. The manual command bypasses this indirectly: it only
// fetches when the cache is older than this window anyway.
export const THROTTLE_MS = 30_000;

/**
 * Cached state for one provider.
 *
 * `at` is the moment the last fetch *settled* (success or failure). It drives
 * both the throttle window and the display freshness check, which coincide:
 * inside the window we show `text`, outside it we show `loadingText` and are
 * free to fetch again.
 */
interface ProviderState {
  text: string | undefined;
  detail: string | undefined;
  at: number;
  inflight: Promise<void> | undefined;
}

export class QuotaLine {
  readonly #providers: readonly QuotaProvider[];
  readonly #state = new Map<string, ProviderState>();
  readonly #now: () => number;

  constructor(
    providers: readonly QuotaProvider[],
    now: () => number = Date.now,
  ) {
    this.#providers = providers;
    this.#now = now;
  }

  /**
   * Plain-text breakdown for the active provider, or `undefined` when the last
   * attempt failed or nothing has settled yet. Read by `/show-provider-quota`.
   */
  getDetail(ctx: ExtensionContext): string | undefined {
    const provider = this.#active(ctx);
    if (!provider) return undefined;
    return this.#state.get(provider.id)?.detail;
  }

  /** Whether a fetch for the active provider is currently in flight. */
  isFetching(ctx: ExtensionContext): boolean {
    const provider = this.#active(ctx);
    if (!provider) return false;
    return this.#state.get(provider.id)?.inflight !== undefined;
  }

  /** Whether the active provider's cached content is inside the throttle window. */
  isFresh(ctx: ExtensionContext): boolean {
    const provider = this.#active(ctx);
    if (!provider) return false;
    const state = this.#state.get(provider.id);
    return state?.text !== undefined && this.#now() - state.at < THROTTLE_MS;
  }

  /**
   * Repaint for the current provider, then refresh it. Used by `session_start`
   * and `model_select`: the paint is unconditional so switching to a provider
   * with a cache swaps the row immediately instead of leaving the previous
   * provider's text in place.
   */
  activate(ctx: ExtensionContext): void {
    this.#paint(ctx);
    void this.refresh(ctx);
  }

  /**
   * Throttled refresh. Returns the in-flight promise when one already exists,
   * so callers (the command) can await it instead of stacking a request.
   */
  refresh(ctx: ExtensionContext): Promise<void> {
    const provider = this.#active(ctx);
    if (!provider) {
      this.#paint(ctx);
      return Promise.resolve();
    }

    const state = this.#stateFor(provider.id);
    if (state.inflight) return state.inflight;

    const now = this.#now();
    // Throttled: keep the current content untouched. Deliberately checked
    // before painting the loading placeholder so nothing flickers.
    if (state.at > 0 && now - state.at < THROTTLE_MS) {
      return Promise.resolve();
    }

    this.#paint(ctx);
    const run = this.#fetch(ctx, provider, state, now);
    state.inflight = run;
    return run;
  }

  async #fetch(
    ctx: ExtensionContext,
    provider: QuotaProvider,
    state: ProviderState,
    now: number,
  ): Promise<void> {
    try {
      const result = await provider.render(ctx, now);
      state.text = result.text;
      state.detail = result.detail;
    } catch {
      // The provider is not supposed to throw. Keep the invariant that an
      // exception never reaches the host and never leaves a stale detail.
      state.text = undefined;
      state.detail = undefined;
    } finally {
      state.at = this.#now();
      state.inflight = undefined;
      this.#paint(ctx);
    }
  }

  /**
   * The only writer to the status bar. Reads the active provider's slot, so a
   * result that settles for a provider we already left cannot resurrect its
   * line.
   */
  #paint(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;

    const provider = this.#active(ctx);
    if (!provider) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }

    const state = this.#stateFor(provider.id);
    const fresh =
      state.text !== undefined && this.#now() - state.at < THROTTLE_MS;
    ctx.ui.setStatus(
      STATUS_KEY,
      fresh ? state.text : provider.loadingText(ctx),
    );
  }

  #active(ctx: ExtensionContext): QuotaProvider | undefined {
    return providerFor(this.#providers, ctx.model?.provider);
  }

  #stateFor(id: string): ProviderState {
    let state = this.#state.get(id);
    if (!state) {
      state = {
        text: undefined,
        detail: undefined,
        at: 0,
        inflight: undefined,
      };
      this.#state.set(id, state);
    }
    return state;
  }
}
