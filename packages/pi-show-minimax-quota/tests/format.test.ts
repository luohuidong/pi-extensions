import { describe, it } from "node:test";

import type { AggregatedQuota } from "../src/aggregate.ts";
import { formatDuration, formatStatusLine } from "../src/format.ts";
import { expect } from "./helpers/expect.ts";
import { theme } from "./helpers/theme.ts";

describe("formatDuration", () => {
  it("returns 0m for zero or negative input", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(-1)).toBe("0m");
  });

  it("rounds sub-minute durations up to at least 1m", () => {
    expect(formatDuration(1)).toBe("1m");
    expect(formatDuration(30_000)).toBe("1m"); // 30s rounds to 1m
  });

  it("formats only minutes when total < 1h", () => {
    expect(formatDuration(60 * 1000)).toBe("1m"); // 1 min
    expect(formatDuration(3 * 60 * 1000)).toBe("3m"); // spec example
    expect(formatDuration(59 * 60 * 1000)).toBe("59m");
  });

  it("formats hours and minutes when 1h ≤ total < 1d", () => {
    expect(formatDuration(60 * 60 * 1000)).toBe("1h0m");
    expect(formatDuration(2 * 60 * 60 * 1000 + 35 * 60 * 1000)).toBe("2h35m"); // spec example
    expect(formatDuration(23 * 60 * 60 * 1000 + 59 * 60 * 1000)).toBe("23h59m");
  });

  it("formats days and hours, dropping minutes, for total ≥ 1d", () => {
    expect(formatDuration(24 * 60 * 60 * 1000)).toBe("1d0h");
    expect(formatDuration(5 * 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000)).toBe(
      "5d8h",
    ); // spec example
  });

  it("rounds to the nearest minute (no seconds leaked through)", () => {
    // 90s = 1.5 min → round to 2m
    expect(formatDuration(90 * 1000)).toBe("2m");
    // 30s = 0.5 min → round to 1m (already covered, but be explicit)
    expect(formatDuration(30 * 1000)).toBe("1m");
  });

  it("renders realistic aggregate values from the documented example `5h 20% (2h35m) 7d 30% (5d8h)`", () => {
    const q: AggregatedQuota = {
      h5Pct: 20,
      h5Ms: 2 * 60 * 60 * 1000 + 35 * 60 * 1000,
      d7Pct: 30,
      d7Ms: 5 * 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000,
    };
    expect(formatDuration(q.h5Ms)).toBe("2h35m");
    expect(formatDuration(q.d7Ms)).toBe("5d8h");
  });

  it("renders the close-to-reset example `5h 20% (3m) 7d 30% (3m)`", () => {
    const q: AggregatedQuota = {
      h5Pct: 20,
      h5Ms: 3 * 60 * 1000,
      d7Pct: 30,
      d7Ms: 3 * 60 * 1000,
    };
    expect(formatDuration(q.h5Ms)).toBe("3m");
    expect(formatDuration(q.d7Ms)).toBe("3m");
  });
});

describe("formatStatusLine", () => {
  it("matches the spec's shape and color buckets", () => {
    const q: AggregatedQuota = {
      h5Pct: 80, // → success
      h5Ms: 3 * 60 * 60 * 1000 + 12 * 60 * 1000, // 3h12m
      d7Pct: 30, // → warning
      d7Ms: 4 * 24 * 60 * 60 * 1000 + 6 * 60 * 60 * 1000, // 4d6h
    };
    const out = formatStatusLine(theme, q);
    expect(out).toBe(
      "[dim]MiniMax Token Plan[/][dim] · [/][dim]5h[/] [success]80%[/] [dim]([/][dim]3h12m[/][dim])[/][dim] · [/][dim]7d[/] [warning]30%[/] [dim]([/][dim]4d6h[/][dim])[/]",
    );
  });

  it("uses the error color below 20%", () => {
    const out = formatStatusLine(theme, {
      h5Pct: 15,
      h5Ms: 10 * 60 * 1000,
      d7Pct: 90,
      d7Ms: 60 * 60 * 1000,
    });
    expect(out).toContain("[error]15%[/]");
    expect(out).toContain("[success]90%[/]");
  });

  it("renders the close-to-reset example from the spec", () => {
    const out = formatStatusLine(theme, {
      h5Pct: 20,
      h5Ms: 3 * 60 * 1000,
      d7Pct: 30,
      d7Ms: 3 * 60 * 1000,
    });
    expect(out).toBe(
      "[dim]MiniMax Token Plan[/][dim] · [/][dim]5h[/] [warning]20%[/] [dim]([/][dim]3m[/][dim])[/][dim] · [/][dim]7d[/] [warning]30%[/] [dim]([/][dim]3m[/][dim])[/]",
    );
  });
});
