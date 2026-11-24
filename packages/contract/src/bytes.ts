export const base64FromBytes = (bytes: Uint8Array) => {
  let binary = "";
  const chunk = 0x80_00;

  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCodePoint(...bytes.subarray(i, i + chunk));
  }

  return btoa(binary);
};

export const bytesFromBase64 = (value: string) =>
  Uint8Array.from(atob(value), (char) => char.codePointAt(0) ?? 0);

const utf8 = new TextEncoder();

export const utf8ByteLength = (text: string) => utf8.encode(text).byteLength;
