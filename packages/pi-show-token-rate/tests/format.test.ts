/**
 * Status-line formatting, including the spec's colour buckets.
 */

import { describe, it } from "node:test";
import { formatRate, formatStatusLine } from "../src/format.ts";
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

  it("paints the marker green while streaming and dim once it stops", () => {
    expect(formatStatusLine(theme, { rate: 62, streaming: true })).toBe(
      "[success]⚡[/] [success]62[/] [dim]tok/s[/]",
    );
    // The marker is green even when the rate itself is yellow or red.
    expect(formatStatusLine(theme, { rate: 30, streaming: true })).toBe(
      "[success]⚡[/] [warning]30[/] [dim]tok/s[/]",
    );
    expect(formatStatusLine(theme, { rate: 2.5, streaming: true })).toBe(
      "[success]⚡[/] [error]2.5[/] [dim]tok/s[/]",
    );
    // Idle, whatever the colour the rate would have had: the marker is dim.
    expect(formatStatusLine(theme, { rate: 62 })).toBe(
      "[dim]⚡[/] [dim]62[/] [dim]tok/s[/]",
    );
  });

  it("is green above 50 tok/s", () => {
    expect(formatStatusLine(theme, { rate: 51, streaming: true })).toBe(
      "[success]⚡[/] [success]51[/] [dim]tok/s[/]",
    );
    expect(formatStatusLine(theme, { rate: 240, streaming: true })).toBe(
      "[success]⚡[/] [success]240[/] [dim]tok/s[/]",
    );
  });

  it("is yellow from 10 through 50 tok/s", () => {
    expect(formatStatusLine(theme, { rate: 10, streaming: true })).toBe(
      "[success]⚡[/] [warning]10[/] [dim]tok/s[/]",
    );
    expect(formatStatusLine(theme, { rate: 50, streaming: true })).toBe(
      "[success]⚡[/] [warning]50[/] [dim]tok/s[/]",
    );
    expect(formatStatusLine(theme, { rate: 30.4, streaming: true })).toBe(
      "[success]⚡[/] [warning]30[/] [dim]tok/s[/]",
    );
  });

  it("is red below 10 tok/s", () => {
    expect(formatStatusLine(theme, { rate: 9.4, streaming: true })).toBe(
      "[success]⚡[/] [error]9.4[/] [dim]tok/s[/]",
    );
    expect(formatStatusLine(theme, { rate: 4.2, streaming: true })).toBe(
      "[success]⚡[/] [error]4.2[/] [dim]tok/s[/]",
    );
  });

  it("buckets by the value it displays", () => {
    // 50.4 displays "50", so it stays in the yellow band…
    expect(formatStatusLine(theme, { rate: 50.4, streaming: true })).toBe(
      "[success]⚡[/] [warning]50[/] [dim]tok/s[/]",
    );
    // …while 50.6 displays "51" and goes green.
    expect(formatStatusLine(theme, { rate: 50.6, streaming: true })).toBe(
      "[success]⚡[/] [success]51[/] [dim]tok/s[/]",
    );
    // 9.96 displays "10", so it is yellow rather than red.
    expect(formatStatusLine(theme, { rate: 9.96, streaming: true })).toBe(
      "[success]⚡[/] [warning]10[/] [dim]tok/s[/]",
    );
  });

  it("keeps the marker green over a carried-over reading", () => {
    expect(
      formatStatusLine(theme, { rate: 62, streaming: true, measured: false }),
    ).toBe("[success]⚡[/] [dim]62[/] [dim]tok/s[/]");
    expect(formatStatusLine(theme, { streaming: true, measured: false })).toBe(
      "[success]⚡[/] [dim]tok/s —[/]",
    );
  });

  it("dims the frozen rate once the stream is over", () => {
    // No `streaming` flag — the default is the idle state.
    expect(formatStatusLine(theme, { rate: 62.4 })).toBe(
      "[dim]⚡[/] [dim]62[/] [dim]tok/s[/]",
    );
    expect(formatStatusLine(theme, { rate: 62.4, streaming: false })).toBe(
      "[dim]⚡[/] [dim]62[/] [dim]tok/s[/]",
    );
    expect(formatStatusLine(theme, { rate: 240 })).toBe(
      "[dim]⚡[/] [dim]240[/] [dim]tok/s[/]",
    );
  });
});
