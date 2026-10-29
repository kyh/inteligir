import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DEV_NATIVE_HOST_NAME,
  EXTENSION_ID,
  EXTENSION_ORIGIN,
  EXTENSION_PUBLIC_KEY,
  NATIVE_HOST_NAME,
} from "./extension-identity";

// Chrome's own derivation: sha256 of the DER key, its first 32 hex digits mapped 0-f to a-p
const A = "a".codePointAt(0) ?? 0;

const idOfKey = (key: string): string =>
  Array.from(
    createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32),
    (digit) => String.fromCodePoint(A + Number.parseInt(digit, 16)),
  ).join("");

describe("the extension's identity", () => {
  it("is the id Chrome derives from the committed key", () => {
    expect(idOfKey(EXTENSION_PUBLIC_KEY)).toBe(EXTENSION_ID);
    expect(EXTENSION_ORIGIN).toBe(`chrome-extension://${EXTENSION_ID}/`);
  });

  it("names its hosts in Chrome's native-messaging grammar", () => {
    for (const name of [NATIVE_HOST_NAME, DEV_NATIVE_HOST_NAME]) {
      expect(name).toMatch(/^[a-z0-9_]+(?:\.[a-z0-9_]+)*$/u);
    }
  });
});
