import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EXTENSION_ID, EXTENSION_ORIGIN, EXTENSION_PUBLIC_KEY } from "./extension-identity";

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
  });

  it("calls from the origin a browser names for that id: its scheme and id, with no path", () => {
    expect(EXTENSION_ORIGIN).toBe(`chrome-extension://${EXTENSION_ID}`);
  });
});
