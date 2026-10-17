import { describe, it } from "node:test";

import { formatDuration, pctColor } from "../../src/core/format.ts";
import { expect } from "../helpers/expect.ts";
import { theme } from "../helpers/theme.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

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

describe("pctColor", () => {
  it("is green below 70% used", () => {
    expect(pctColor(theme, 0)).toBe("[success]0%[/]");
    expect(pctColor(theme, 69)).toBe("[success]69%[/]");
  });

  it("is yellow from 70% up to 89% used", () => {
    expect(pctColor(theme, 70)).toBe("[warning]70%[/]");
    expect(pctColor(theme, 89)).toBe("[warning]89%[/]");
  });

  it("is red from 90% used", () => {
    expect(pctColor(theme, 90)).toBe("[error]90%[/]");
    expect(pctColor(theme, 100)).toBe("[error]100%[/]");
  });

  it("shows fractional percentages exactly as passed", () => {
    expect(pctColor(theme, 31.7)).toBe("[success]31.7%[/]");
  });
});
