import { describe, expect, it } from "vitest";
import { parseStoredCredential, serializeCredential } from "../credential-codec";

const VALID = { credential: `igd_${"a".repeat(64)}`, deviceId: "dev_1" };

describe("the credential codec parses at the boundary", () => {
  it("round-trips a valid credential", () => {
    expect(parseStoredCredential(serializeCredential(VALID))).toStrictEqual(VALID);
  });

  it("reads a null, malformed, or wrong-shaped record as signed out", () => {
    expect(parseStoredCredential(null)).toBeNull();
    expect(parseStoredCredential("{ not json")).toBeNull();
    // A credential that does not match the wire pattern must read as "signed out",
    // never as a token the cloud refuses on every request forever.
    expect(parseStoredCredential(JSON.stringify({ credential: "nope", deviceId: "d" }))).toBeNull();
    expect(parseStoredCredential(JSON.stringify({ deviceId: "d" }))).toBeNull();
  });
});
