// web-crypto globals only: this leaf loads on workerd, node, the browser and hermes.

import { bytesToHex } from "@noble/hashes/utils.js";

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

// base64url with no padding (RFC 4648 § 5), as a signed ticket's segments and a PKCE challenge
// spell their bytes
export const base64UrlFromBytes = (bytes: Uint8Array): string =>
  base64FromBytes(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/[=]+$/u, "");

// atob throws on a string that is not base64; a caller parses before it decodes
export const bytesFromBase64 = (value: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(value), (char) => char.codePointAt(0) ?? 0);

export const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
};
