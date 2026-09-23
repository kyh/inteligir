// not `string.length`: it counts UTF-16 units, and slicing by it can halve a surrogate pair,
// which reaches the model as U+FFFD. `encodeInto` writes whole code points only, so `read` is
// always a boundary, and a U+FFFD the text really holds survives the cut.
export const headCapUtf8 = (text: string, maxBytes: number): string => {
  const { read } = new TextEncoder().encodeInto(text, new Uint8Array(maxBytes));
  return text.slice(0, read);
};
