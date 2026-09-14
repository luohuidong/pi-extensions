import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { resolveAuth } from "../src/auth.ts";
import { expect } from "./helpers/expect.ts";

describe("resolveAuth", () => {
  let dir: string;
  let authPath: string;

  beforeEach(() => {
    // Fresh temp dir per test so no state leaks across cases.
    dir = mkdtempSync(join(tmpdir(), "minimax-quota-auth-"));
    authPath = join(dir, "auth.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeAuth(content: string): void {
    writeFileSync(authPath, content, "utf8");
  }

  it("returns missing when the auth.json file is missing", () => {
    // No writeAuth call — authPath points at a nonexistent file.
    expect(resolveAuth(authPath)).toEqual({ kind: "missing" });
  });

  it("returns missing when auth.json is not valid JSON", () => {
    writeAuth("not json {");
    expect(resolveAuth(authPath)).toEqual({ kind: "missing" });
  });

  it("returns missing when the minimax-cn provider is absent", () => {
    writeAuth(
      JSON.stringify({
        "some-other-provider": { type: "api_key", key: "sk-other" },
      }),
    );
    expect(resolveAuth(authPath)).toEqual({ kind: "missing" });
  });

  it("returns missing when the minimax-cn key is empty", () => {
    writeAuth(JSON.stringify({ "minimax-cn": { type: "api_key", key: "" } }));
    expect(resolveAuth(authPath)).toEqual({ kind: "missing" });
  });

  it("returns missing when the minimax-cn entry is an OAuth credential", () => {
    // OAuth tokens don't authorise the Token Plan endpoint; treat as missing.
    writeAuth(
      JSON.stringify({
        "minimax-cn": {
          type: "oauth",
          access: "acc",
          refresh: "ref",
          expires: Date.now() + 3600_000,
        },
      }),
    );
    expect(resolveAuth(authPath)).toEqual({ kind: "missing" });
  });

  it("returns wrong-type when the minimax-cn key is a pay-as-you-go (sk-api-) credential", () => {
    // PAYG keys authorize /account/query_balance, not the Token Plan endpoint.
    writeAuth(
      JSON.stringify({ "minimax-cn": { type: "api_key", key: "sk-api-foo" } }),
    );
    expect(resolveAuth(authPath)).toEqual({ kind: "wrong-type" });
  });

  it("returns ok with a Bearer header when the minimax-cn api key is set", () => {
    writeAuth(
      JSON.stringify({ "minimax-cn": { type: "api_key", key: "sk-cp-test" } }),
    );
    expect(resolveAuth(authPath)).toEqual({
      kind: "ok",
      header: "Bearer sk-cp-test",
    });
  });
});
