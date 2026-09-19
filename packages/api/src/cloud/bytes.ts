// web-crypto globals only: this leaf loads on workerd, node, the browser and hermes.

export const hexFromBytes = (bytes: Uint8Array): string => {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
};

// btoa is a global on workerd, node, the browser and hermes (rn 0.74+); Buffer is not. chunked:
// a whole asset spread into fromCharCode overflows the argument list.
export const base64FromBytes = (bytes: Uint8Array): string => {
  let binary = "";
  const chunk = 0x80_00;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCodePoint(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

export const base64UrlFromBytes = (bytes: Uint8Array): string =>
  base64FromBytes(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

export const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return hexFromBytes(new Uint8Array(digest));
};

// hand-rolled because hermes has no timing-safe compare; the length difference folds
// into the accumulator and the loop runs the longer length, so no fixed width is assumed.
/* oxlint-disable no-bitwise -- xor accumulator folds every position's mismatch without a data-dependent branch, which is the point of a timing-safe compare */
export const constantTimeEqual = (a: string, b: string): boolean => {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (a.codePointAt(i) ?? 0) ^ (b.codePointAt(i) ?? 0);
  }
  return diff === 0;
};
/* oxlint-enable no-bitwise */
