/**
 * Minimal `expect()` shim backed by `node:assert/strict`.
 *
 * Keeps the assertion style (`toBe` / `toEqual` / `toBeNull` / `toContain`)
 * used across this workspace's extension tests while running on the Node
 * built-in test runner. Only the matcher primitives below are needed by the
 * current suite.
 */

import assert from "node:assert/strict";

export interface Expect {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toContain(expected: string): void;
}

export function expect(actual: unknown): Expect {
  return {
    toBe(expected) {
      assert.strictEqual(actual, expected);
    },
    toEqual(expected) {
      assert.deepStrictEqual(actual, expected);
    },
    toBeNull() {
      assert.strictEqual(actual, null);
    },
    toContain(expected) {
      assert.ok(
        typeof actual === "string" && actual.includes(expected),
        `expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`,
      );
    },
  };
}
