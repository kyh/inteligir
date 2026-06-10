import { describe, expect, it } from "vitest";
import {
  PAIRING_TOKEN_BYTES,
  ROOM_ID_ALPHABET,
  ROOM_ID_LENGTH,
  formatPairingString,
  generatePairingCredential,
  hashToken,
  isValidRoomId,
  parsePairingString,
} from "./pairing";

describe("generatePairingCredential", () => {
  it("meets the entropy floor", () => {
    // roomId: >= 80 bits; token: >= 128 bits.
    expect(ROOM_ID_LENGTH * Math.log2(ROOM_ID_ALPHABET.length)).toBeGreaterThanOrEqual(80);
    expect(PAIRING_TOKEN_BYTES * 8).toBeGreaterThanOrEqual(128);
  });

  it("produces a canonical roomId and base64url token", () => {
    const { roomId, token } = generatePairingCredential();
    expect(roomId).toHaveLength(ROOM_ID_LENGTH);
    for (const char of roomId) {
      expect(ROOM_ID_ALPHABET).toContain(char);
    }
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("never repeats", () => {
    const a = generatePairingCredential();
    const b = generatePairingCredential();
    expect(a.roomId).not.toBe(b.roomId);
    expect(a.token).not.toBe(b.token);
  });
});

describe("pairing string encode/decode", () => {
  it("round-trips format -> parse", () => {
    const credential = generatePairingCredential();
    const display = formatPairingString(credential);
    expect(display).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}\./);
    expect(parsePairingString(display)).toEqual(credential);
  });

  it("tolerates lowercase roomId, whitespace, and missing dashes", () => {
    const credential = generatePairingCredential();
    const display = formatPairingString(credential);
    const sloppy = `  ${display.slice(0, display.indexOf(".")).toLowerCase().replaceAll("-", "")}${display.slice(display.indexOf("."))} `;
    expect(parsePairingString(sloppy)).toEqual(credential);
  });

  it("keeps the token case-sensitive", () => {
    const credential = { roomId: "A".repeat(ROOM_ID_LENGTH), token: "AbCd".repeat(6).slice(0, 22) };
    const parsed = parsePairingString(formatPairingString(credential));
    expect(parsed?.token).toBe(credential.token);
  });

  it.each([
    ["empty", ""],
    ["no separator", "ABCD-EFGH-JKMN-PQRS"],
    ["short roomId", `ABCD-EFGH.${"a".repeat(22)}`],
    ["roomId with excluded chars", `ABC0-EFGH-JKMN-PQRS.${"a".repeat(22)}`],
    ["roomId with I", `ABCI-EFGH-JKMN-PQRS.${"a".repeat(22)}`],
    ["short token", "ABCD-EFGH-JKMN-PQRS.tooshort"],
    ["token with invalid chars", `ABCD-EFGH-JKMN-PQRS.${"a".repeat(21)}+`],
    ["legacy 6-char room code", "ABC234"],
  ])("rejects %s", (_label, input) => {
    expect(parsePairingString(input)).toBeNull();
  });
});

describe("isValidRoomId", () => {
  it("accepts canonical roomIds only", () => {
    expect(isValidRoomId(generatePairingCredential().roomId)).toBe(true);
    expect(isValidRoomId("abcd-efgh-jkmn-pqrs")).toBe(false);
    expect(isValidRoomId("ABC234")).toBe(false);
    expect(isValidRoomId("")).toBe(false);
  });
});

describe("hashToken", () => {
  it("matches the SHA-256 test vector", async () => {
    await expect(hashToken("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is deterministic and collision-separating", async () => {
    const a = await hashToken("token-a");
    const b = await hashToken("token-a");
    const c = await hashToken("token-b");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
