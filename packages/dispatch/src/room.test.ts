import { describe, expect, it } from "vitest";
import { createConnectionAttemptRegistry } from "./connection";
import {
  PARTY_NAME,
  ROLE_QUERY_PARAM,
  TOKEN_QUERY_PARAM,
  buildConnectionConfig,
  parseConnectionAuth,
} from "./room";

describe("buildConnectionConfig", () => {
  it("builds PartySocket options with role and token query params", () => {
    const config = buildConnectionConfig({
      host: "localhost:8787",
      roomId: "ABCDEFGHJKMNPQRS",
      role: "desktop",
      token: "tok_123",
    });
    expect(config).toEqual({
      host: "localhost:8787",
      party: PARTY_NAME,
      room: "ABCDEFGHJKMNPQRS",
      query: { role: "desktop", token: "tok_123" },
    });
  });

  it("keeps query keys in sync with the exported param names", () => {
    const config = buildConnectionConfig({
      host: "h",
      roomId: "r",
      role: "mobile",
      token: "t",
    });
    expect(new Set(Object.keys(config.query))).toEqual(
      new Set([ROLE_QUERY_PARAM, TOKEN_QUERY_PARAM]),
    );
  });
});

function urlFor(params: Record<string, string>): URL {
  const url = new URL("https://relay.example/parties/dispatch-server/ROOM");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

describe("parseConnectionAuth", () => {
  it("round-trips a built config through a request URL", () => {
    const config = buildConnectionConfig({
      host: "relay.example",
      roomId: "ABCDEFGHJKMNPQRS",
      role: "mobile",
      token: "raw-token-22-chars-aaa",
    });
    const url = urlFor(config.query);
    expect(parseConnectionAuth(url)).toEqual({
      role: "mobile",
      token: "raw-token-22-chars-aaa",
    });
  });

  it("rejects a missing role", () => {
    expect(parseConnectionAuth(urlFor({ token: "t" }))).toBeNull();
  });

  it("rejects an unknown role", () => {
    expect(parseConnectionAuth(urlFor({ role: "tablet", token: "t" }))).toBeNull();
  });

  it("rejects a missing or empty token", () => {
    expect(parseConnectionAuth(urlFor({ role: "desktop" }))).toBeNull();
    expect(parseConnectionAuth(urlFor({ role: "desktop", token: "" }))).toBeNull();
  });
});

describe("createConnectionAttemptRegistry", () => {
  it("marks only the latest attempt per key as current", () => {
    const registry = createConnectionAttemptRegistry();
    const first = registry.begin("room-a");
    expect(first.isCurrent()).toBe(true);

    const second = registry.begin("room-a");
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);

    registry.cancel("room-a");
    expect(second.isCurrent()).toBe(false);
  });

  it("tracks keys independently", () => {
    const registry = createConnectionAttemptRegistry();
    const a = registry.begin("room-a");
    const b = registry.begin("room-b");
    registry.cancel("room-a");
    expect(a.isCurrent()).toBe(false);
    expect(b.isCurrent()).toBe(true);
  });
});
