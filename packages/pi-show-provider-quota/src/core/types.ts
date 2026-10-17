/**
 * Shared provider contract.
 *
 * A `QuotaProvider` is a plain configuration object that bundles everything a
 * single vendor needs: how to resolve its credentials, how to fetch and
 * normalize quota data, how to pick the right failure placeholder, and how to
 * render the status line and the detail breakdown. The core controller never
 * learns a vendor name, an HTTP shape, or a percent semantic; it only calls
 * `render` and shows what comes back.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface RenderResult {
  /** Status-bar content, already themed. */
  text: string;
  /**
   * Plain-text breakdown for `/show-provider-quota`. Plain text (no theme
   * tags) because the host paints the whole `notify` message itself. Only
   * present when the fetch produced usable data — the command treats a
   * missing detail as "nothing to show".
   */
  detail?: string;
}

export interface QuotaProvider {
  /** Stable id, also the `Map` key for this provider's cached state. */
  id: string;
  /**
   * Model provider ids this object handles. A list so several vendors
   * regions can deliberately share one quota account and one adapter.
   */
  providerIds: readonly string[];
  /** Dim placeholder shown while the cache is missing or stale. */
  loadingText(ctx: ExtensionContext): string;
  /**
   * Runs the whole pipeline: resolve auth, fetch, normalize, and pick between
   * the aggregated line and the failure placeholders.
   *
   * Must never throw for an expected failure — every known error is mapped to
   * a placeholder `text` here. The core still wraps the call defensively so a
   * bug never propagates into the host.
   */
  render(ctx: ExtensionContext, now: number): Promise<RenderResult>;
}
