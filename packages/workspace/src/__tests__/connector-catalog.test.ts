// catalogInstallRequest — the pure catalog-entry → install-request mapping the
// connectors UI sends over the host-orchestrated installConnector channel.
// The orchestration itself is the host's, and is not exercised here.

import { describe, expect, it } from "vitest";

import {
  catalogInstallRequest,
  CONNECTOR_CATALOG,
} from "@repo/workspace/settings/extensions/connector-catalog";

function connector(id: string) {
  const c = CONNECTOR_CATALOG.find((x) => x.id === id);
  if (!c) throw new Error(`no catalog connector ${id}`);
  return c;
}

describe("catalogInstallRequest", () => {
  it("maps an OAuth MCP connector", () => {
    const req = catalogInstallRequest(connector("github"));
    expect(req.source).toMatchObject({ type: "mcp", slug: "github" });
    expect(req.auth).toEqual({ kind: "oauth" });
  });

  it("maps an API-key connector with the supplied secret value", () => {
    const req = catalogInstallRequest(connector("huggingface"), "hf_token");
    expect(req.source.type).toBe("mcp");
    expect(req.auth).toMatchObject({
      kind: "apiKey",
      headerName: "Authorization",
      prefix: "Bearer ",
      value: "hf_token",
    });
  });

  it("maps a Google connector to a discovery-bundle source with Google OAuth", () => {
    const req = catalogInstallRequest(connector("gmail"));
    expect(req.source).toMatchObject({ type: "google", slug: "gmail" });
    expect(req.auth).toEqual({ kind: "google" });
  });

  it("throws when an API-key connector is mapped without a secret value", () => {
    expect(() => catalogInstallRequest(connector("huggingface"))).toThrow(/secret value/);
  });
});
