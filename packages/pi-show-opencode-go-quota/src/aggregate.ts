/**
 * Usage payload → three normalized quota windows.
 *
 * The endpoint reports percentages pre-computed (`percent` = *used* %,
 * floored by the server), so nothing is re-derived here: we only clamp,
 * drop malformed fields, and convert `resetsAt` into epoch milliseconds.
 *
 * `percent === 0` is explicitly *not* special-cased. The upstream
 * implementation fills `resetsAt` with a `now + window` placeholder when a
 * window has never seen usage, and there is no reliable way to tell that
 * value apart from a real anchor — so we surface whatever the API returns
 * rather than guessing.
 *
 * `status` is treated as informational. A window counts as "present" only
 * when it carries a finite `percent`, which is the field the status bar
 * actually renders.
 */

import type { RawUsage, RawWindow } from "./api.ts";

export interface QuotaWindow {
  /** Used percentage, clamped to 0–100. Displayed verbatim. */
  usedPct: number;
  /** Epoch milliseconds at which the window resets; 0 means unknown. */
  resetsAtMs: number;
}

export interface AggregatedQuota {
  rolling: QuotaWindow;
  weekly: QuotaWindow;
  monthly: QuotaWindow;
}

function emptyWindow(): QuotaWindow {
  return { usedPct: 0, resetsAtMs: 0 };
}

function readPercent(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function readResetsAt(value: string | null | undefined): number {
  if (typeof value !== "string") return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

function readWindow(win: RawWindow | undefined): QuotaWindow | null {
  if (!win) return null;
  const usedPct = readPercent(win.percent);
  if (usedPct === null) return null;
  return { usedPct, resetsAtMs: readResetsAt(win.resetsAt) };
}

/**
 * Normalizes the usage payload.
 *
 * Returns `null` when none of the three windows carries a usable
 * `percent` — the caller turns that into the `no quota data` placeholder
 * instead of silently showing three zeros.
 */
export function aggregate(body: RawUsage): AggregatedQuota | null {
  const usage = body?.usage;
  const rolling = readWindow(usage?.rolling);
  const weekly = readWindow(usage?.weekly);
  const monthly = readWindow(usage?.monthly);

  if (!rolling && !weekly && !monthly) return null;

  return {
    rolling: rolling ?? emptyWindow(),
    weekly: weekly ?? emptyWindow(),
    monthly: monthly ?? emptyWindow(),
  };
}
