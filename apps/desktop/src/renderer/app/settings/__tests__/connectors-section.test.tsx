// The pure halves of the connectors form: the draft→request gate (the
// disabled state and the submit read one answer), the argv line split, and
// the poll that waits out an OAuth round trip.

import { CONNECTOR_SCOPES_MAX } from "@repo/api/local/connectors/connectors-schema";
import type { ConnectorView } from "@repo/api/local/connectors/connectors-schema";
import { describe, expect, it } from "vitest";
import {
  argumentLines,
  authorizePollInterval,
  draftToRequest,
  EMPTY_DRAFT,
} from "../connectors-section";
import type { AddConnectorDraft } from "../connectors-section";

const OAUTH_DRAFT: AddConnectorDraft = {
  ...EMPTY_DRAFT,
  authorizationEndpoint: "https://linear.app/oauth/authorize",
  clientId: "client-1",
  kind: "oauth",
  name: "linear",
  tokenEndpoint: "https://api.linear.app/oauth/token",
  url: "https://mcp.linear.app/mcp",
};

const scopes = (count: number): string =>
  Array.from({ length: count }, (_, index) => `scope${String(index)}`).join(" ");

describe("draftToRequest", () => {
  it("refuses names outside the grammar, and says which rule", () => {
    expect(draftToRequest({ ...EMPTY_DRAFT, name: "bad name" })).toEqual({
      ok: false,
      problem: "The name must use letters, numbers, '-' and '_' only.",
    });
    expect(draftToRequest({ ...EMPTY_DRAFT, name: "a".repeat(65), url: "https://x.dev" })).toEqual({
      ok: false,
      problem: "The name is at most 64 characters.",
    });
  });

  it("refuses more scopes than the contract carries, as the server would", () => {
    expect(
      draftToRequest({ ...OAUTH_DRAFT, scopesText: scopes(CONNECTOR_SCOPES_MAX + 1) }),
    ).toEqual({ ok: false, problem: `At most ${String(CONNECTOR_SCOPES_MAX)} scopes.` });
    expect(draftToRequest({ ...OAUTH_DRAFT, scopesText: scopes(CONNECTOR_SCOPES_MAX) }).ok).toBe(
      true,
    );
  });

  it("names the OAuth field a refusal is about", () => {
    expect(draftToRequest({ ...OAUTH_DRAFT, url: "ftp://mcp.linear.app" })).toEqual({
      ok: false,
      problem: "The server URL must be an http:// or https:// URL.",
    });
    expect(draftToRequest({ ...OAUTH_DRAFT, clientId: " " })).toEqual({
      ok: false,
      problem: "The client id is required when the endpoints are named.",
    });
    expect(draftToRequest({ ...OAUTH_DRAFT, tokenEndpoint: "" })).toEqual({
      ok: false,
      problem: "The token endpoint is required alongside the other endpoint.",
    });
  });

  it("takes an OAuth server by its URL alone, leaving what is blank for discovery", () => {
    expect(
      draftToRequest({ ...EMPTY_DRAFT, kind: "oauth", name: "linear", url: OAUTH_DRAFT.url }),
    ).toEqual({ ok: true, transport: { kind: "oauth", scopes: [], url: OAUTH_DRAFT.url } });
    expect(
      draftToRequest({
        ...EMPTY_DRAFT,
        clientId: " my-client ",
        kind: "oauth",
        name: "linear",
        url: OAUTH_DRAFT.url,
      }),
    ).toEqual({
      ok: true,
      transport: { clientId: "my-client", kind: "oauth", scopes: [], url: OAUTH_DRAFT.url },
    });
  });

  it("builds an http transport and carries the auth header only when whole", () => {
    const whole = draftToRequest({
      ...EMPTY_DRAFT,
      headerName: "x-api-key",
      headerValue: "sk",
      name: "exa",
      url: "https://mcp.exa.ai/mcp",
    });
    expect(whole).toEqual({
      ok: true,
      transport: { headers: { "x-api-key": "sk" }, kind: "http", url: "https://mcp.exa.ai/mcp" },
    });

    const half = draftToRequest({
      ...EMPTY_DRAFT,
      headerName: "x-api-key",
      name: "exa",
      url: "https://mcp.exa.ai/mcp",
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
        argsText: "-y\nserver-files\n\n",
        command: "npx",
        kind: "stdio",
        name: "files",
      }),
    ).toEqual({
      ok: true,
      transport: { args: ["-y", "server-files"], command: "npx", kind: "stdio" },
    });
  });
});

const oauthRow = (status: "needs-auth" | "connected" | "needs-reauth"): ConnectorView => ({
  enabled: true,
  name: "linear",
  transport: {
    authorizationEndpoint: OAUTH_DRAFT.authorizationEndpoint,
    clientId: OAUTH_DRAFT.clientId,
    kind: "oauth",
    scopes: [],
    status,
    tokenEndpoint: OAUTH_DRAFT.tokenEndpoint,
    url: OAUTH_DRAFT.url,
  },
});

describe("authorizePollInterval", () => {
  const awaited = { name: "linear", until: 10_000 };

  it("polls while the awaited row is still waiting on the browser", () => {
    expect(authorizePollInterval(awaited, [oauthRow("needs-auth")], 0)).toBeGreaterThan(0);
    expect(authorizePollInterval(awaited, [oauthRow("needs-reauth")], 0)).toBeGreaterThan(0);
  });

  it("stops once the row reads connected, the row is gone, or the wait runs out", () => {
    expect(authorizePollInterval(awaited, [oauthRow("connected")], 0)).toBe(false);
    expect(authorizePollInterval(awaited, [], 0)).toBe(false);
    expect(authorizePollInterval(awaited, [oauthRow("needs-auth")], 10_000)).toBe(false);
  });

  it("does not poll when no authorize is awaited", () => {
    expect(authorizePollInterval(null, [oauthRow("needs-auth")], 0)).toBe(false);
  });
});

describe("argumentLines", () => {
  it("splits on lines and drops blanks", () => {
    expect(argumentLines(" a \n\nb\n")).toEqual(["a", "b"]);
  });
});
