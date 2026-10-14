/**
 * Character-based token estimation.
 */

import { describe, it } from "node:test";
import {
  countWideChars,
  estimateTokens,
  estimateTokensFromChars,
} from "../src/rate/index.ts";
import { expect } from "./helpers/expect.ts";

describe("estimateTokensFromChars", () => {
  it("divides narrow text by four and rounds up", () => {
    expect(estimateTokensFromChars(4)).toBe(1);
    expect(estimateTokensFromChars(5)).toBe(2);
    expect(estimateTokensFromChars(1234)).toBe(309);
  });

  it("charges wide characters about one token each", () => {
    expect(estimateTokensFromChars(20, 8)).toBe(8 + 3);
    expect(estimateTokensFromChars(8, 8)).toBe(8);
    // A wide count larger than the total cannot add tokens.
    expect(estimateTokensFromChars(8, 99)).toBe(8);
    expect(estimateTokensFromChars(0, 5)).toBe(0);
  });

  it("charges tool-call JSON at the denser tool ratio", () => {
    expect(estimateTokensFromChars(400, 0, 2.5)).toBe(160);
    expect(
      estimateTokens({
        textChars: 400,
        textWideChars: 0,
        toolChars: 400,
        toolWideChars: 0,
      }),
    ).toBe(100 + 160);
    // Wide characters inside arguments still cost about one token each.
    expect(
      estimateTokens({
        textChars: 0,
        textWideChars: 0,
        toolChars: 4,
        toolWideChars: 4,
      }),
    ).toBe(4);
  });

  it("zeroes out non-positive and non-finite input", () => {
    expect(estimateTokensFromChars(0)).toBe(0);
    expect(estimateTokensFromChars(-10)).toBe(0);
    expect(estimateTokensFromChars(Number.NaN)).toBe(0);
    expect(estimateTokensFromChars(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("countWideChars", () => {
  it("counts CJK, kana, Hangul, and fullwidth punctuation", () => {
    expect(countWideChars("我们先分析一下")).toBe(7);
    expect(countWideChars("かなカナ")).toBe(4);
    expect(countWideChars("한국어")).toBe(3);
    expect(countWideChars("，。（）！")).toBe(5);
  });

  it("leaves narrow text alone", () => {
    expect(countWideChars("hello, world")).toBe(0);
    expect(countWideChars("tok/s 62")).toBe(0);
  });
});
