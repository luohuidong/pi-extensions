/**
 * Shared theme stub for tests.
 *
 * `fg` / `bg` return tagged strings (`[color]text[/]`) so assertions can
 * check colors without depending on the real ANSI palette (which differs
 * across pi themes and modes).
 */

import type { formatStatusLine } from "../../src/format.ts";

export function makeTheme(): {
  fg: (color: string, text: string) => string;
  bg: (color: string, text: string) => string;
} {
  return {
    fg: (color: string, text: string) => `[${color}]${text}[/]`,
    bg: (color: string, text: string) => `[bg:${color}]${text}[/]`,
  };
}

export const theme = makeTheme() as unknown as Parameters<
  typeof formatStatusLine
>[0];
