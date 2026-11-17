// web-crypto globals only: this leaf loads on workerd, node, the browser and hermes.

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

// atob throws on a string that is not base64; a caller parses before it decodes
export const bytesFromBase64 = (value: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(value), (char) => char.codePointAt(0) ?? 0);
