/**
 * Cut to at most `maxBytes` of UTF-8 WITHOUT splitting a character. Measuring
 * `string.length` would count UTF-16 units (wrong for any non-BMP text) and
 * slicing by it can halve a surrogate pair, which reaches the model as U+FFFD.
 *
 * Every prompt this server builds pays for its bytes, so several surfaces cap
 * against budgets of their own — session instructions, the per-turn view
 * context, the body handed to note inference. "Cut UTF-8 to N bytes without
 * splitting a code point" must not get a second answer.
 */
export function headCapUtf8(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) {
    return text;
  }
  // fatal:false lets the decoder drop a trailing partial sequence rather than
  // throw; the cut is then on a real code-point boundary.
  const decoded = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes.subarray(0, maxBytes));
  return decoded.endsWith("�") ? decoded.slice(0, -1) : decoded;
}
