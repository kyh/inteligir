// ---------------------------------------------------------------------------
// The boundary an object on the other side of an HTTP hop reaches. Every
// handler behind these parsers assumes the shape held, so a body that slipped
// through would be read as a contract it does not satisfy.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import { parseBoot, parseTurn, parseVaultPush } from "../requests";

const BOOT = {
  bootId: "boot-1",
  reportUrl: "https://host/v1/agent/u/report",
  reportToken: "t",
  provider: { provider: "anthropic", modelId: "m", baseUrl: "https://api", apiKey: "placeholder" },
  tools: [{ name: "search_vault", description: "d", parameters: { type: "object" } }],
  instructions: "",
  browserCdpUrl: null,
  browserCdpToken: null,
};

const TURN = {
  turnId: "turn-1",
  kind: "user_message",
  text: "hello",
  images: [],
  seed: [],
  seededThrough: 1,
};

describe("parseBoot", () => {
  it("accepts the payload the object sends", () => {
    expect(parseBoot(BOOT)).toEqual(BOOT);
  });

  it("refuses a boot with no id", () => {
    expect(parseBoot({ ...BOOT, bootId: "" })).toBe(null);
  });

  it("refuses a field the contract does not declare", () => {
    expect(parseBoot({ ...BOOT, extra: true })).toBe(null);
  });

  it("refuses a provider that is missing its model", () => {
    expect(parseBoot({ ...BOOT, provider: { ...BOOT.provider, modelId: "" } })).toBe(null);
  });
});

describe("parseVaultPush", () => {
  it("accepts a delta and a whole-vault replacement alike", () => {
    const delta = { toRevision: 3, replaceAll: false, upserted: [], removed: ["a.md"] };
    expect(parseVaultPush(delta)).toEqual(delta);
    const whole = {
      toRevision: 4,
      replaceAll: true,
      upserted: [{ path: "a.md", bytesBase64: "" }],
      removed: [],
    };
    expect(parseVaultPush(whole)).toEqual(whole);
  });

  it("refuses an empty path", () => {
    expect(
      parseVaultPush({
        toRevision: 1,
        replaceAll: false,
        upserted: [{ path: "", bytesBase64: "" }],
        removed: [],
      }),
    ).toBe(null);
  });

  it("refuses a push with no revision", () => {
    expect(parseVaultPush({ replaceAll: true, upserted: [], removed: [] })).toBe(null);
  });
});

describe("parseTurn", () => {
  it("accepts each of the three kinds", () => {
    for (const kind of ["user_message", "steer", "follow_up"]) {
      expect(parseTurn({ ...TURN, kind })).toMatchObject({ kind });
    }
  });

  it("refuses a kind the daemon has no branch for", () => {
    expect(parseTurn({ ...TURN, kind: "interrupt" })).toBe(null);
  });

  it("refuses a seed entry with a role that is not user or assistant", () => {
    expect(parseTurn({ ...TURN, seed: [{ role: "system", text: "x" }] })).toBe(null);
  });
});
