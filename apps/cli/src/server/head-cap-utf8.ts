// not `string.length`: it counts UTF-16 units, and slicing by it can halve a
// surrogate pair, which reaches the model as U+FFFD.
export function headCapUtf8(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) {
    return text;
  }
  // the non-fatal decoder drops a trailing partial sequence instead of throwing.
  const decoded = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes.subarray(0, maxBytes));
  return decoded.endsWith("�") ? decoded.slice(0, -1) : decoded;
}
