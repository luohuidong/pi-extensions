/**
 * Status-line and summary formatting.
 */

import { describe, it } from "node:test";
import { formatRate, formatStatusLine, formatSummary } from "../src/format.ts";
import type { RateSample } from "../src/rate.ts";
import { expect } from "./helpers/expect.ts";
import { theme } from "./helpers/theme.ts";

describe("formatRate", () => {
  it("keeps one decimal below 10 tok/s", () => {
    expect(formatRate(0.4)).toBe("0.4");
    expect(formatRate(7.44)).toBe("7.4");
  });

  it("rounds to whole tokens above 10 tok/s", () => {
    // 9.99 rounds to the whole form 10 already gets, not to "10.0".
    expect(formatRate(9.99)).toBe("10");
    expect(formatRate(62.4)).toBe("62");
    expect(formatRate(120.6)).toBe("121");
  });

  it("renders a dash for values that are not rates", () => {
    expect(formatRate(0)).toBe("—");
    expect(formatRate(-1)).toBe("—");
    expect(formatRate(Number.NaN)).toBe("—");
  });
});

describe("formatStatusLine", () => {
  it("shows a placeholder before anything was measured", () => {
    expect(formatStatusLine(theme, {})).toBe("[dim]⚡[/] [dim]tok/s —[/]");
  });

  it("treats a missing or invalid rate as no measurement", () => {
    expect(formatStatusLine(theme, { rate: Number.NaN })).toBe(
      "[dim]⚡[/] [dim]tok/s —[/]",
    );
    expect(formatStatusLine(theme, { rate: 0 })).toBe(
      "[dim]⚡[/] [dim]tok/s —[/]",
    );
  });

  it("colours the rate by speed bucket", () => {
    expect(formatStatusLine(theme, { rate: 62.4 })).toBe(
      "[dim]⚡[/] [success]62[/] [dim]tok/s[/]",
    );
    expect(formatStatusLine(theme, { rate: 30 })).toBe(
      "[dim]⚡[/] [warning]30[/] [dim]tok/s[/]",
    );
    expect(formatStatusLine(theme, { rate: 4.2 })).toBe(
      "[dim]⚡[/] [dim]4.2[/] [dim]tok/s[/]",
    );
  });

  it("prefixes estimated rates with a tilde", () => {
    expect(formatStatusLine(theme, { rate: 62, estimated: true })).toBe(
      "[dim]⚡[/] [dim]~[/][success]62[/] [dim]tok/s[/]",
    );
  });

  it("appends the session average when there is one", () => {
    expect(formatStatusLine(theme, { rate: 50, average: 56.25 })).toBe(
      "[dim]⚡[/] [success]50[/] [dim]tok/s[/][dim] · avg [/][dim]56[/]",
    );
  });

  it("drops a non-positive average", () => {
    expect(formatStatusLine(theme, { rate: 50, average: 0 })).toBe(
      "[dim]⚡[/] [success]50[/] [dim]tok/s[/]",
    );
  });
});

describe("formatSummary", () => {
  const sample = (
    tokPerSec: number,
    source: "usage" | "estimate",
  ): RateSample => ({
    tokens: 100,
    elapsedMs: Math.round(100_000 / tokPerSec),
    tokPerSec,
    source,
  });

  it("explains an empty history", () => {
    expect(
      formatSummary({
        count: 0,
        last: undefined,
        average: undefined,
        peak: undefined,
        estimated: 0,
      }),
    ).toBe("no completed responses yet");
  });

  it("summarizes last / avg / peak and the sample count", () => {
    expect(
      formatSummary({
        count: 3,
        last: sample(50, "usage"),
        average: 56.2,
        peak: 91.4,
        estimated: 1,
      }),
    ).toBe(
      "last 50 tok/s · avg 56 tok/s · peak 91 tok/s · 3 responses · 1 estimated",
    );
  });

  it("uses the singular for a single response and hides a zero count", () => {
    expect(
      formatSummary({
        count: 1,
        last: sample(50, "usage"),
        average: 50,
        peak: 50,
        estimated: 0,
      }),
    ).toBe("last 50 tok/s · avg 50 tok/s · peak 50 tok/s · 1 response");
  });
});
