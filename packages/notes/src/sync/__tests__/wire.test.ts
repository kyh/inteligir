import { describe, expect, it } from "vitest";

import type { VaultChange } from "../sync-port";
import {
  API_VERSION,
  changesPath,
  filePath,
  formatBearer,
  formatChangeFrame,
  formatVersionHeader,
  manifestPath,
  parseFilePathParam,
  parseVersionHeader,
  SSE_CHANGE_EVENT,
  vaultPath,
} from "../wire";

describe("route builders", () => {
  it("vaultPath prefixes the version and percent-encodes the vault id", () => {
    expect(vaultPath("abc", "manifest")).toBe(`/${API_VERSION}/vault/abc/manifest`);
    expect(vaultPath("a/b", "file")).toBe(`/${API_VERSION}/vault/a%2Fb/file`);
  });

  it("manifestPath / changesPath hit their sub-resources", () => {
    expect(manifestPath("v1")).toBe(`/${API_VERSION}/vault/v1/manifest`);
    expect(changesPath("v1")).toBe(`/${API_VERSION}/vault/v1/changes`);
  });

  it("filePath carries the vault path as a percent-encoded query param", () => {
    expect(filePath("v1", "notes/todo.md")).toBe(
      `/${API_VERSION}/vault/v1/file?path=notes%2Ftodo.md`,
    );
  });

  it("filePath round-trips through parseFilePathParam", () => {
    const path = "notes/a b & c/über.md";
    const built = filePath("v1", path);
    const query = built.slice(built.indexOf("?"));
    expect(parseFilePathParam(query)).toBe(path);
  });
});

describe("parseFilePathParam", () => {
  it("reads the path param with or without a leading '?'", () => {
    expect(parseFilePathParam("?path=a.md")).toBe("a.md");
    expect(parseFilePathParam("path=a.md")).toBe("a.md");
  });

  it("finds path among other params", () => {
    expect(parseFilePathParam("?x=1&path=a.md&y=2")).toBe("a.md");
  });

  it("returns null when path is absent or empty", () => {
    expect(parseFilePathParam("?x=1")).toBeNull();
    expect(parseFilePathParam("?path=")).toBeNull();
    expect(parseFilePathParam("")).toBeNull();
  });

  it("returns null on malformed percent-encoding", () => {
    expect(parseFilePathParam("?path=%zz")).toBeNull();
  });
});

describe("version header", () => {
  it("round-trips a non-negative integer (incl. the create sentinel 0)", () => {
    for (const version of [0, 1, 42]) {
      expect(parseVersionHeader(formatVersionHeader(version))).toBe(version);
    }
  });

  it("rejects missing, non-numeric, signed, or fractional values", () => {
    expect(parseVersionHeader(null)).toBeNull();
    expect(parseVersionHeader("")).toBeNull();
    expect(parseVersionHeader("-1")).toBeNull();
    expect(parseVersionHeader("1.5")).toBeNull();
    expect(parseVersionHeader("abc")).toBeNull();
  });

  it("rejects an out-of-safe-range integer", () => {
    expect(parseVersionHeader("99999999999999999999")).toBeNull();
  });
});

describe("bearer auth", () => {
  it("formats a bearer authorization header value", () => {
    expect(formatBearer("tok123")).toBe("Bearer tok123");
  });
});

describe("formatChangeFrame", () => {
  it("serializes an upsert as an SSE frame with the change as JSON data", () => {
    const change: VaultChange = {
      kind: "upserted",
      file: { path: "a.md", contentHash: "h", version: 1, size: 3 },
    };
    expect(formatChangeFrame(change)).toBe(
      `event: ${SSE_CHANGE_EVENT}\ndata: ${JSON.stringify(change)}\n\n`,
    );
  });

  it("serializes a delete change", () => {
    const change: VaultChange = { kind: "deleted", path: "a.md" };
    expect(formatChangeFrame(change)).toBe(
      `event: change\ndata: {"kind":"deleted","path":"a.md"}\n\n`,
    );
  });
});
