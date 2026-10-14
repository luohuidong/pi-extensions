import { describe, it } from "node:test";

import type { AggregatedQuota } from "../src/aggregate.ts";
import {
  formatDetail,
  formatDuration,
  formatStatusLine,
} from "../src/format.ts";
import { expect } from "./helpers/expect.ts";
import { theme } from "./helpers/theme.ts";

const NOW = Date.parse("2026-10-14T11:12:10.000Z");

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Builds a quota whose countdowns are relative to NOW. */
function quota(
  rolling: [number, number],
  weekly: [number, number],
  monthly: [number, number],
): AggregatedQuota {
  return {
    rolling: {
      usedPct: rolling[0],
      resetsAtMs: rolling[1] === 0 ? 0 : NOW + rolling[1],
    },
    weekly: {
      usedPct: weekly[0],
      resetsAtMs: weekly[1] === 0 ? 0 : NOW + weekly[1],
    },
    monthly: {
      usedPct: monthly[0],
      resetsAtMs: monthly[1] === 0 ? 0 : NOW + monthly[1],
    },
  };
}

describe("formatDuration", () => {
  it("returns 0m for zero or negative input", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(-1)).toBe("0m");
  });

  it("rounds sub-minute durations up to at least 1m", () => {
    expect(formatDuration(1)).toBe("1m");
    expect(formatDuration(30_000)).toBe("1m");
  });

  it("formats only minutes when total < 1h", () => {
    expect(formatDuration(MIN)).toBe("1m");
    expect(formatDuration(3 * MIN)).toBe("3m");
    expect(formatDuration(59 * MIN)).toBe("59m");
  });

  it("formats hours and minutes when 1h ≤ total < 1d", () => {
    expect(formatDuration(HOUR)).toBe("1h0m");
    expect(formatDuration(2 * HOUR + 35 * MIN)).toBe("2h35m");
    expect(formatDuration(23 * HOUR + 59 * MIN)).toBe("23h59m");
  });

  it("formats days and hours, dropping minutes, for total ≥ 1d", () => {
    expect(formatDuration(DAY)).toBe("1d0h");
    expect(formatDuration(5 * DAY + 8 * HOUR)).toBe("5d8h");
  });

  it("rounds to the nearest minute (no seconds leak through)", () => {
    expect(formatDuration(90 * 1000)).toBe("2m");
    expect(formatDuration(30 * 1000)).toBe("1m");
  });
});

describe("formatStatusLine", () => {
  /** Strips the test theme's `[color]` / `[/]` tags to measure the real width. */
  function plain(line: string): string {
    return line.replace(/\[[^\]]*\]/g, "");
  }

  it("renders the three windows positionally with no labels", () => {
    const out = formatStatusLine(
      theme,
      quota(
        [1, 3 * HOUR + 28 * MIN],
        [6, 4 * DAY + 7 * HOUR],
        [3, 28 * DAY + 20 * HOUR],
      ),
      NOW,
    );
    expect(out).toBe(
      "[dim]Go[/][dim]·[/][success]1%[/][dim]([/][dim]3h28m[/][dim])[/]" +
        "[dim]·[/][success]6%[/][dim]([/][dim]4d7h[/][dim])[/]" +
        "[dim]·[/][success]3%[/][dim]([/][dim]28d20h[/][dim])[/]",
    );
    // The whole point of dropping the labels: 32 visible columns.
    expect(plain(out)).toBe("Go·1%(3h28m)·6%(4d7h)·3%(28d20h)");
  });

  it("stays narrow even when every window is maxed out", () => {
    const out = formatStatusLine(
      theme,
      quota([100, 0], [100, 0], [100, 0]),
      NOW,
    );
    expect(plain(out)).toBe("Go·100%·100%·100%");
    expect(plain(out).length <= 40).toBe(true);
  });

  it("colors used percentages at the 70 / 90 thresholds", () => {
    const green = formatStatusLine(theme, quota([69, 0], [0, 0], [0, 0]), NOW);
    expect(green).toContain("[success]69%[/]");

    const yellowLow = formatStatusLine(
      theme,
      quota([70, 0], [0, 0], [0, 0]),
      NOW,
    );
    expect(yellowLow).toContain("[warning]70%[/]");

    const yellowHigh = formatStatusLine(
      theme,
      quota([89, 0], [0, 0], [0, 0]),
      NOW,
    );
    expect(yellowHigh).toContain("[warning]89%[/]");

    const red = formatStatusLine(theme, quota([90, 0], [0, 0], [0, 0]), NOW);
    expect(red).toContain("[error]90%[/]");
  });

  it("omits the countdown when a window has no usable resetsAt", () => {
    const out = formatStatusLine(theme, quota([12, 0], [0, 0], [0, 0]), NOW);
    expect(plain(out)).toBe("Go·12%·0%·0%");
  });

  it("floors an already-elapsed countdown at 0m", () => {
    const q: AggregatedQuota = {
      rolling: { usedPct: 12, resetsAtMs: NOW - 5 * MIN },
      weekly: { usedPct: 0, resetsAtMs: 0 },
      monthly: { usedPct: 0, resetsAtMs: 0 },
    };
    expect(formatStatusLine(theme, q, NOW)).toContain(
      "[dim]([/][dim]0m[/][dim])[/]",
    );
  });

  it("shows fractional percentages exactly as the API returned them", () => {
    const out = formatStatusLine(theme, quota([31.7, 0], [0, 0], [0, 0]), NOW);
    expect(out).toContain("[success]31.7%[/]");
  });

  it("shows a 100% window in the error color", () => {
    const out = formatStatusLine(theme, quota([100, 0], [0, 0], [0, 0]), NOW);
    expect(out).toContain("[error]100%[/]");
  });
});

describe("formatDetail", () => {
  it("labels all three windows in the same order as the status line", () => {
    const out = formatDetail(
      quota(
        [1, 3 * HOUR + 28 * MIN],
        [6, 4 * DAY + 7 * HOUR],
        [3, 28 * DAY + 20 * HOUR],
      ),
      NOW,
    );
    expect(out).toBe(
      [
        "OpenCode Go usage (used %)",
        "  Rolling 1% (3h28m)",
        "  Weekly  6% (4d7h)",
        "  Monthly 3% (28d20h)",
      ].join("\n"),
    );
  });

  it("omits the countdown for a window without a usable resetsAt", () => {
    const out = formatDetail(quota([12, 0], [0, 0], [0, 0]), NOW);
    expect(out).toBe(
      [
        "OpenCode Go usage (used %)",
        "  Rolling 12%",
        "  Weekly  0%",
        "  Monthly 0%",
      ].join("\n"),
    );
  });

  it("carries no theme tags, so notify() can paint it itself", () => {
    const out = formatDetail(quota([1, 0], [2, 0], [3, 0]), NOW);
    expect(out.includes("[")).toBe(false);
  });
});
