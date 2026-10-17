import { describe, it } from "node:test";

import type { AggregatedQuota } from "../../../src/providers/minimax/aggregate.ts";
import {
  formatDetail,
  formatStatusLine,
} from "../../../src/providers/minimax/format.ts";
import { expect } from "../../helpers/expect.ts";
import { theme } from "../../helpers/theme.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatStatusLine (MiniMax)", () => {
  /** Strips the test theme's `[color]` / `[/]` tags to measure the real width. */
  function plain(line: string): string {
    return line.replace(/\[[^\]]*\]/g, "");
  }

  it("renders the two windows positionally with no labels", () => {
    const q: AggregatedQuota = {
      h5Pct: 5, // green
      h5Ms: 11 * MIN,
      d7Pct: 7, // green
      d7Ms: DAY + 9 * HOUR,
    };
    const out = formatStatusLine(theme, q);
    expect(out).toBe(
      "[dim]MPlan[/][dim]·[/][success]5%[/][dim]([/][dim]11m[/][dim])[/]" +
        "[dim]·[/][success]7%[/][dim]([/][dim]1d9h[/][dim])[/]",
    );
    expect(plain(out)).toBe("MPlan·5%(11m)·7%(1d9h)");
  });

  it("uses yellow and red on the unified used thresholds", () => {
    const out = formatStatusLine(theme, {
      h5Pct: 70, // yellow
      h5Ms: 10 * MIN,
      d7Pct: 90, // red
      d7Ms: HOUR,
    });
    expect(out).toContain("[warning]70%[/]");
    expect(out).toContain("[error]90%[/]");
  });

  it("renders the documented example shape", () => {
    const out = formatStatusLine(theme, {
      h5Pct: 20,
      h5Ms: 2 * HOUR + 35 * MIN,
      d7Pct: 30,
      d7Ms: 5 * DAY + 8 * HOUR,
    });
    expect(plain(out)).toBe("MPlan·20%(2h35m)·30%(5d8h)");
  });
});

describe("formatDetail (MiniMax)", () => {
  it("labels both windows in the same order as the status line", () => {
    const out = formatDetail({
      h5Pct: 20,
      h5Ms: 2 * HOUR + 35 * MIN,
      d7Pct: 30,
      d7Ms: 5 * DAY + 8 * HOUR,
    });
    expect(out).toBe(
      [
        "MiniMax Token Plan usage (used %)",
        "  5h  20% (2h35m)",
        "  7d  30% (5d8h)",
      ].join("\n"),
    );
  });

  it("carries no theme tags, so notify() can paint it itself", () => {
    const out = formatDetail({ h5Pct: 1, h5Ms: 0, d7Pct: 2, d7Ms: 0 });
    expect(out.includes("[")).toBe(false);
  });
});
