/**
 * Segment formatting, including the spec's colour buckets and the composed
 * row. Pure functions: no clock, no controller.
 */

import { describe, it } from "node:test";

import {
  formatRate,
  formatTps,
  formatTtft,
  RATE_UNIT,
  TTFT_UNIT_MS,
  TTFT_UNIT_S,
  ttftDisplay,
} from "../src/format.ts";
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

describe("ttftDisplay", () => {
  it("uses whole milliseconds below one second", () => {
    expect(ttftDisplay(840)).toEqual({
      value: "840",
      unit: TTFT_UNIT_MS,
      seconds: 0.84,
    });
    expect(ttftDisplay(0.4)).toEqual({
      value: "0",
      unit: TTFT_UNIT_MS,
      seconds: 0,
    });
  });

  it("uses one decimal of seconds from one second up", () => {
    expect(ttftDisplay(1_000)).toEqual({
      value: "1.0",
      unit: TTFT_UNIT_S,
      seconds: 1,
    });
    expect(ttftDisplay(1_240)).toEqual({
      value: "1.2",
      unit: TTFT_UNIT_S,
      seconds: 1.2,
    });
  });

  it("returns null for values that are not latencies", () => {
    expect(ttftDisplay(0)).toBeNull();
    expect(ttftDisplay(-1)).toBeNull();
    expect(ttftDisplay(Number.NaN)).toBeNull();
  });
});

describe("formatTps", () => {
  it("shows a placeholder before anything was measured", () => {
    expect(formatTps(theme, {})).toBe(`[dim]TPS[/] [dim]— ${RATE_UNIT}[/]`);
  });

  it("treats a missing or invalid rate as no measurement", () => {
    expect(formatTps(theme, { rate: Number.NaN })).toBe(
      `[dim]TPS[/] [dim]— ${RATE_UNIT}[/]`,
    );
    expect(formatTps(theme, { rate: 0 })).toBe(
      `[dim]TPS[/] [dim]— ${RATE_UNIT}[/]`,
    );
  });

  it("keeps the label dim and colours only the number", () => {
    expect(formatTps(theme, { rate: 62, streaming: true })).toBe(
      "[dim]TPS[/] [success]62[/] [dim]tok/s[/]",
    );
    expect(formatTps(theme, { rate: 30, streaming: true })).toBe(
      "[dim]TPS[/] [warning]30[/] [dim]tok/s[/]",
    );
    expect(formatTps(theme, { rate: 2.5, streaming: true })).toBe(
      "[dim]TPS[/] [error]2.5[/] [dim]tok/s[/]",
    );
    // Idle: whatever the colour the rate would have had, the number is dim.
    expect(formatTps(theme, { rate: 62 })).toBe(
      "[dim]TPS[/] [dim]62[/] [dim]tok/s[/]",
    );
    // A carried-over reading is not a measurement of the live response.
    expect(
      formatTps(theme, { rate: 62, streaming: true, measured: false }),
    ).toBe("[dim]TPS[/] [dim]62[/] [dim]tok/s[/]");
  });

  it("is green above 50 tok/s", () => {
    expect(formatTps(theme, { rate: 50.6, streaming: true })).toBe(
      "[dim]TPS[/] [success]51[/] [dim]tok/s[/]",
    );
  });

  it("is yellow from 10 through 50 tok/s", () => {
    expect(formatTps(theme, { rate: 50.4, streaming: true })).toBe(
      "[dim]TPS[/] [warning]50[/] [dim]tok/s[/]",
    );
    expect(formatTps(theme, { rate: 10, streaming: true })).toBe(
      "[dim]TPS[/] [warning]10[/] [dim]tok/s[/]",
    );
  });

  it("is red below 10 tok/s", () => {
    expect(formatTps(theme, { rate: 9.9, streaming: true })).toBe(
      "[dim]TPS[/] [error]9.9[/] [dim]tok/s[/]",
    );
  });
});

describe("formatTtft", () => {
  it("shows a placeholder before anything was measured", () => {
    expect(formatTtft(theme, {})).toBe(
      `[dim]TTFT[/] [dim]— ${TTFT_UNIT_MS}[/]`,
    );
  });

  it("keeps the label dim and colours only the number", () => {
    expect(formatTtft(theme, { ms: 840, streaming: true })).toBe(
      "[dim]TTFT[/] [success]840[/][dim]ms[/]",
    );
    expect(formatTtft(theme, { ms: 1_240, streaming: true })).toBe(
      "[dim]TTFT[/] [warning]1.2[/][dim]s[/]",
    );
    expect(formatTtft(theme, { ms: 4_000, streaming: true })).toBe(
      "[dim]TTFT[/] [error]4.0[/][dim]s[/]",
    );
    // Idle and carried-over readings are dim.
    expect(formatTtft(theme, { ms: 1_240 })).toBe(
      "[dim]TTFT[/] [dim]1.2[/][dim]s[/]",
    );
    expect(
      formatTtft(theme, { ms: 1_240, streaming: true, measured: false }),
    ).toBe("[dim]TTFT[/] [dim]1.2[/][dim]s[/]");
  });

  it("buckets by the displayed value", () => {
    // 999ms prints green, 1000ms prints yellow: the unit switch is the edge.
    expect(formatTtft(theme, { ms: 999, streaming: true })).toBe(
      "[dim]TTFT[/] [success]999[/][dim]ms[/]",
    );
    expect(formatTtft(theme, { ms: 1_000, streaming: true })).toBe(
      "[dim]TTFT[/] [warning]1.0[/][dim]s[/]",
    );
    // 3.04s rounds to 3.0 and stays yellow; 3.06s rounds to 3.1 and goes red.
    expect(formatTtft(theme, { ms: 3_040, streaming: true })).toBe(
      "[dim]TTFT[/] [warning]3.0[/][dim]s[/]",
    );
    expect(formatTtft(theme, { ms: 3_060, streaming: true })).toBe(
      "[dim]TTFT[/] [error]3.1[/][dim]s[/]",
    );
    // 999.6 rounds to 1000ms and so prints as 1.0s (yellow), never "1000ms".
    expect(formatTtft(theme, { ms: 999.6, streaming: true })).toBe(
      "[dim]TTFT[/] [warning]1.0[/][dim]s[/]",
    );
  });
});
