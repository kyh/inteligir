import { describe, expect, it } from "vitest";

import type { VaultChange } from "../sync-port";
import {
  API_VERSION,
  base32LowerEncode,
  base64UrlDecode,
  base64UrlEncode,
  changesPath,
  devicesPath,
  enrollOfferPath,
  enrollPath,
  DEVICE_ASSERTION_DOMAIN,
  DEVICE_ASSERTION_VERSION,
  deviceAssertionSignedBytes,
  ED25519_PUBLIC_KEY_BYTES,
  ED25519_SIGNATURE_BYTES,
  encodeDeviceAssertionPayload,
  filePath,
  formatBearer,
  formatChangeFrame,
  formatDeviceAssertion,
  formatVersionHeader,
  isValidVaultId,
  manifestPath,
  parseBearer,
  parseDeviceAssertion,
  parseDeviceAssertionPayload,
  parseFilePathParam,
  parseVersionHeader,
  revokePath,
  SSE_CHANGE_EVENT,
  vaultIdFromKeyDigest,
  vaultPath,
  VAULT_ID_PREFIX,
  type DeviceAssertionPayload,
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

  it("round-trips through parseBearer, scheme case notwithstanding", () => {
    expect(parseBearer(formatBearer("tok123"))).toBe("tok123");
    expect(parseBearer("bearer tok123")).toBe("tok123");
    expect(parseBearer("BEARER  tok123 ")).toBe("tok123");
  });

  it("rejects a missing, empty or foreign-scheme header", () => {
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer("")).toBeNull();
    expect(parseBearer("Bearer ")).toBeNull();
    expect(parseBearer("Bearer   ")).toBeNull();
    expect(parseBearer("Basic dXNlcjpwYXNz")).toBeNull();
    expect(parseBearer("tok123")).toBeNull();
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

describe("base64url", () => {
  it("round-trips every byte-length remainder, unpadded", () => {
    for (let length = 0; length <= 8; length += 1) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) bytes[i] = (i * 37 + 11) % 256;
      const encoded = base64UrlEncode(bytes);
      expect(encoded).not.toContain("=");
      expect(base64UrlDecode(encoded)).toEqual(bytes);
    }
  });

  it("uses the url-safe alphabet", () => {
    expect(base64UrlEncode(new Uint8Array([251, 255]))).toBe("-_8");
  });

  it("rejects a foreign character, an impossible length, and stray trailing bits", () => {
    expect(base64UrlDecode("ab+c")).toBeNull();
    expect(base64UrlDecode("abcde")).toBeNull();
    // "AB" carries a 1 in bits no byte can hold — two spellings of one byte
    // would otherwise let an assertion's text be mutated in place.
    expect(base64UrlDecode("AB")).toBeNull();
    expect(base64UrlDecode("AA")).toEqual(new Uint8Array([0]));
  });
});

describe("device assertions", () => {
  const publicKey = filled(ED25519_PUBLIC_KEY_BYTES, 7);
  const signature = filled(ED25519_SIGNATURE_BYTES, 3);

  function payload(overrides: Partial<DeviceAssertionPayload> = {}): DeviceAssertionPayload {
    return {
      v: DEVICE_ASSERTION_VERSION,
      vid: "v1abcdef",
      dev: base64UrlEncode(publicKey),
      iat: 1_700_000_000,
      exp: 1_700_000_300,
      ...overrides,
    };
  }

  it("round-trips a payload through its encoding", () => {
    const encoded = encodeDeviceAssertionPayload(payload());
    expect(encoded).not.toBeNull();
    expect(parseDeviceAssertionPayload(encoded ?? "")).toEqual(payload());
  });

  it("refuses to encode claims the parser would reject", () => {
    expect(
      encodeDeviceAssertionPayload(payload({ dev: base64UrlEncode(filled(31, 5)) })),
    ).toBeNull();
    expect(encodeDeviceAssertionPayload(payload({ exp: 1_700_000_000 }))).toBeNull();
    expect(encodeDeviceAssertionPayload(payload({ vid: "vault/one" }))).toBeNull();
    expect(encodeDeviceAssertionPayload(payload({ iat: 1.5 }))).toBeNull();
  });

  it("parses a payload's claims out of untrusted text", () => {
    expect(parseDeviceAssertionPayload("not base64url!")).toBeNull();
    expect(parseDeviceAssertionPayload(base64UrlEncode(asciiBytes("not json")))).toBeNull();
    expect(parseDeviceAssertionPayload(base64UrlEncode(asciiBytes("[1,2]")))).toBeNull();
    const wrongVersion = JSON.stringify({ ...payload(), v: DEVICE_ASSERTION_VERSION + 1 });
    expect(parseDeviceAssertionPayload(base64UrlEncode(asciiBytes(wrongVersion)))).toBeNull();
  });

  it("signs over the domain-separated encoded payload", () => {
    const encoded = encodeDeviceAssertionPayload(payload()) ?? "";
    expect(new TextDecoder().decode(deviceAssertionSignedBytes(encoded))).toBe(
      `${DEVICE_ASSERTION_DOMAIN}${encoded}`,
    );
  });

  it("round-trips a whole assertion, handing the verifier its bytes", () => {
    const encoded = encodeDeviceAssertionPayload(payload()) ?? "";
    const parsed = parseDeviceAssertion(formatDeviceAssertion(encoded, signature));

    expect(parsed?.payload).toEqual(payload());
    expect(parsed?.signature).toEqual(signature);
    expect(parsed?.devicePublicKey).toEqual(publicKey);
    expect(parsed?.signedBytes).toEqual(deviceAssertionSignedBytes(encoded));
  });

  it("rejects a malformed assertion", () => {
    const encoded = encodeDeviceAssertionPayload(payload()) ?? "";
    const assertion = formatDeviceAssertion(encoded, signature);

    expect(parseDeviceAssertion(encoded)).toBeNull();
    expect(parseDeviceAssertion(`${assertion}.extra`)).toBeNull();
    expect(parseDeviceAssertion(formatDeviceAssertion(encoded, filled(63, 3)))).toBeNull();
    expect(parseDeviceAssertion(`tampered.${base64UrlEncode(signature)}`)).toBeNull();
  });
});

/** A deterministic byte string of an exact length. */
function filled(length: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = (i * seed + seed) % 256;
  return bytes;
}

/** ASCII text → bytes, mirroring what the module does internally. */
function asciiBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}

describe("device route builders", () => {
  it("each device sub-resource gets its own path", () => {
    expect(enrollOfferPath("vid")).toBe(`/${API_VERSION}/vault/vid/enroll-offer`);
    expect(enrollPath("vid")).toBe(`/${API_VERSION}/vault/vid/enroll`);
    expect(devicesPath("vid")).toBe(`/${API_VERSION}/vault/vid/devices`);
    expect(revokePath("vid")).toBe(`/${API_VERSION}/vault/vid/revoke`);
  });
});

function ascii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}

function digest(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

describe("base32LowerEncode", () => {
  it("matches the RFC 4648 test vectors, lowercased and unpadded", () => {
    expect(base32LowerEncode(ascii(""))).toBe("");
    expect(base32LowerEncode(ascii("f"))).toBe("my");
    expect(base32LowerEncode(ascii("fo"))).toBe("mzxq");
    expect(base32LowerEncode(ascii("foo"))).toBe("mzxw6");
    expect(base32LowerEncode(ascii("foob"))).toBe("mzxw6yq");
    expect(base32LowerEncode(ascii("fooba"))).toBe("mzxw6ytb");
    expect(base32LowerEncode(ascii("foobar"))).toBe("mzxw6ytboi");
  });

  it("stays inside the alphabet for arbitrary bytes", () => {
    const every = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) every[i] = i;
    expect(base32LowerEncode(every)).toMatch(/^[a-z2-7]+$/);
  });
});

describe("vault ids", () => {
  it("derives a 54-character self-certifying id from a 32-byte digest", () => {
    const id = vaultIdFromKeyDigest(digest(0xab));
    expect(id).not.toBeNull();
    if (id === null) throw new Error("unreachable");
    expect(id).toHaveLength(54);
    expect(id.startsWith(VAULT_ID_PREFIX)).toBe(true);
    expect(isValidVaultId(id)).toBe(true);
  });

  it("different digests derive different ids", () => {
    expect(vaultIdFromKeyDigest(digest(1))).not.toBe(vaultIdFromKeyDigest(digest(2)));
  });

  it("refuses anything that is not a sha-256 digest", () => {
    expect(vaultIdFromKeyDigest(new Uint8Array(31))).toBeNull();
    expect(vaultIdFromKeyDigest(new Uint8Array(33))).toBeNull();
  });

  it("rejects ids of the wrong shape — the gate on the unauthenticated enroll route", () => {
    expect(isValidVaultId("")).toBe(false);
    expect(isValidVaultId("v1")).toBe(false);
    expect(isValidVaultId("6f1a2b3c-0000-4000-8000-000000000000")).toBe(false); // today's UUIDs
    expect(isValidVaultId(`${VAULT_ID_PREFIX}${"a".repeat(51)}`)).toBe(false);
    expect(isValidVaultId(`${VAULT_ID_PREFIX}${"a".repeat(53)}`)).toBe(false);
    expect(isValidVaultId(`${VAULT_ID_PREFIX}${"A".repeat(52)}`)).toBe(false); // uppercase
    expect(isValidVaultId(`${VAULT_ID_PREFIX}${"1".repeat(52)}`)).toBe(false); // 0/1/8/9 aren't base32
  });
});
