// The pure halves of the connectors form: the draft→request gate (the
// disabled state and the submit read one answer) and the argv line split.

import { describe, expect, it } from "vitest";
import { argumentLines, draftToRequest, EMPTY_DRAFT } from "../connectors-section";

describe("draftToRequest", () => {
  it("refuses names outside the grammar", () => {
    expect(draftToRequest({ ...EMPTY_DRAFT, name: "bad name" }).ok).toBe(false);
  });

  it("builds an http transport and carries the auth header only when whole", () => {
    const whole = draftToRequest({
      ...EMPTY_DRAFT,
      name: "exa",
      url: "https://mcp.exa.ai/mcp",
      headerName: "x-api-key",
      headerValue: "sk",
    });
    expect(whole).toEqual({
      ok: true,
      transport: { headers: { "x-api-key": "sk" }, kind: "http", url: "https://mcp.exa.ai/mcp" },
    });

    const half = draftToRequest({
      ...EMPTY_DRAFT,
      name: "exa",
      url: "https://mcp.exa.ai/mcp",
      headerName: "x-api-key",
    });
    expect(half.ok).toBe(false);
  });

  it("refuses a URL that does not parse as http(s)", () => {
    expect(draftToRequest({ ...EMPTY_DRAFT, name: "a", url: "notaurl" }).ok).toBe(false);
    expect(draftToRequest({ ...EMPTY_DRAFT, name: "a", url: "ftp://x.dev" }).ok).toBe(false);
  });

  it("builds a stdio transport from command + argument lines", () => {
    expect(
      draftToRequest({
        ...EMPTY_DRAFT,
        name: "files",
        kind: "stdio",
        command: "npx",
        argsText: "-y\nserver-files\n\n",
      }),
    ).toEqual({
      ok: true,
      transport: { args: ["-y", "server-files"], command: "npx", kind: "stdio" },
    });
  });
});

describe("argumentLines", () => {
  it("splits on lines and drops blanks", () => {
    expect(argumentLines(" a \n\nb\n")).toEqual(["a", "b"]);
  });
});
