import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  type ApiKeyLookup,
  resolveAuth,
} from "../../../src/providers/opencode-go/auth.ts";
import { expect } from "../../helpers/expect.ts";

/** A registry double whose `getApiKeyForProvider` returns a fixed outcome. */
function registryReturning(key: string | undefined): ApiKeyLookup {
  return { getApiKeyForProvider: async () => key };
}

/** A registry double that throws — the fallback path must still work. */
function registryThrowing(): ApiKeyLookup {
  return {
    getApiKeyForProvider: async () => {
      throw new Error("registry unavailable");
    },
  };
}

describe("resolveAuth (OpenCode Go)", () => {
  let dir: string;
  let authPath: string;

  beforeEach(() => {
    // Fresh temp dir per test so no state leaks across cases.
    dir = mkdtempSync(join(tmpdir(), "provider-quota-opencode-auth-"));
    authPath = join(dir, "auth.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeAuth(content: string): void {
    writeFileSync(authPath, content, "utf8");
  }

  it("prefers the key resolved by pi's model registry", async () => {
    const auth = await resolveAuth(
      registryReturning("oc_sk_from_env"),
      authPath,
    );
    expect(auth).toEqual({ kind: "ok", apiKey: "oc_sk_from_env" });
  });

  it("falls back to auth.json when the registry has no key", async () => {
    writeAuth(
      JSON.stringify({
        "opencode-go": { type: "api_key", key: "oc_sk_from_file" },
      }),
    );
    const auth = await resolveAuth(registryReturning(undefined), authPath);
    expect(auth).toEqual({ kind: "ok", apiKey: "oc_sk_from_file" });
  });

  it("falls back to auth.json when the registry throws", async () => {
    writeAuth(
      JSON.stringify({
        "opencode-go": { type: "api_key", key: "oc_sk_from_file" },
      }),
    );
    const auth = await resolveAuth(registryThrowing(), authPath);
    expect(auth).toEqual({ kind: "ok", apiKey: "oc_sk_from_file" });
  });

  it("treats an empty registry key as absent", async () => {
    writeAuth(
      JSON.stringify({
        "opencode-go": { type: "api_key", key: "oc_sk_from_file" },
      }),
    );
    const auth = await resolveAuth(registryReturning(""), authPath);
    expect(auth).toEqual({ kind: "ok", apiKey: "oc_sk_from_file" });
  });

  it("returns missing when neither source has a key", async () => {
    expect(await resolveAuth(registryReturning(undefined), authPath)).toEqual({
      kind: "missing",
    });
  });

  it("returns missing when auth.json does not exist", async () => {
    // No writeAuth call — authPath points at a nonexistent file.
    expect(await resolveAuth(registryReturning(undefined), authPath)).toEqual({
      kind: "missing",
    });
  });

  it("returns missing when auth.json is not valid JSON", async () => {
    writeAuth("not json {");
    expect(await resolveAuth(registryReturning(undefined), authPath)).toEqual({
      kind: "missing",
    });
  });

  it("returns missing when the opencode-go entry is absent", async () => {
    writeAuth(
      JSON.stringify({ opencode: { type: "api_key", key: "oc_sk_zen" } }),
    );
    expect(await resolveAuth(registryReturning(undefined), authPath)).toEqual({
      kind: "missing",
    });
  });

  it("returns missing when the key is empty", async () => {
    writeAuth(JSON.stringify({ "opencode-go": { type: "api_key", key: "" } }));
    expect(await resolveAuth(registryReturning(undefined), authPath)).toEqual({
      kind: "missing",
    });
  });

  it("returns missing for an oauth credential", async () => {
    writeAuth(
      JSON.stringify({
        "opencode-go": {
          type: "oauth",
          access: "acc",
          refresh: "ref",
          expires: Date.now() + 3600_000,
        },
      }),
    );
    expect(await resolveAuth(registryReturning(undefined), authPath)).toEqual({
      kind: "missing",
    });
  });
});
