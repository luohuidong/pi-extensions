/**
 * The provider table.
 *
 * Adding a vendor is one new module plus one entry here; nothing in `core/` or
 * the extension `index.ts` changes.
 */

import type { QuotaProvider } from "../core/types.ts";
import { minimax } from "./minimax/index.ts";
import { opencodeGo } from "./opencode-go/index.ts";

export const PROVIDERS: QuotaProvider[] = [minimax, opencodeGo];

export { classifyModelSwitch, providerFor } from "../core/lookup.ts";
