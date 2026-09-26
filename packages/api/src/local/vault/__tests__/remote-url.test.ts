import { describe, expect, it } from "vitest";

import { parseRemoteUrl } from "../remote-url";
import { vaultSetRemoteRequestSchema } from "../vault-schema";

describe("the remote url grammar", () => {
  it("accepts the shapes git dials, trimmed", () => {
    for (const url of [
      "https://github.com/kyh/vault.git",
      "ssh://git@github.com/kyh/vault.git",
      "git://example.com/vault.git",
      "file:///Users/me/vault.git",
      "git@github.com:kyh/vault.git",
    ]) {
      expect(parseRemoteUrl(` ${url}\n`)).toEqual({ ok: true, url });
    }
  });

  it("refuses what git would read as an option, a command or a local path", () => {
    for (const url of [
      "",
      "--upload-pack=x",
      "-x@host:vault.git",
      "ext::sh",
      "ext::sh -c evil",
      "/plain/local/path",
      "https://example.com/a vault.git",
    ]) {
      expect(parseRemoteUrl(url).ok, url).toBe(false);
    }
  });

  it("is the request's own grammar, so the wire refuses what the field does", () => {
    expect(
      vaultSetRemoteRequestSchema.safeParse({ kind: "remote", url: "-x@host:vault.git" }).success,
    ).toBe(false);
    expect(
      vaultSetRemoteRequestSchema.parse({ kind: "remote", url: " git@host:vault.git " }),
    ).toEqual({ kind: "remote", url: "git@host:vault.git" });
    expect(vaultSetRemoteRequestSchema.parse({ kind: "account" })).toEqual({ kind: "account" });
  });
});
