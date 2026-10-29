// A media element asks for its file in pieces: AVFoundation probes with `bytes=0-1` and plays only
// once that answers 206, and a seek asks for the bytes from the new position on. One range per
// request is all a player sends, so a list of ranges is answered whole, which RFC 9110 allows.

// `end` is inclusive, as the header and `content-range` spell it
export type ByteRange =
  | { kind: "whole" }
  | { kind: "range"; start: number; end: number }
  | { kind: "unsatisfiable" };

const WHOLE: ByteRange = { kind: "whole" };

const UNSATISFIABLE: ByteRange = { kind: "unsatisfiable" };

// `bytes=<first>-<last>`, `bytes=<first>-` or `bytes=-<suffix length>`, with optional whitespace
const SINGLE_RANGE = /^bytes\s*=\s*(?<first>\d*)\s*-\s*(?<last>\d*)\s*$/u;

// a digit run past this is no offset a file of ours has, and Number would round it
const MAX_DIGITS = 15;

const offsetOf = (digits: string): number | null =>
  digits.length === 0 || digits.length > MAX_DIGITS ? null : Number(digits);

// what a `range` header asks of a file of `size` bytes: a header that is absent or that this
// server does not read (another unit, a list, a malformed one) is answered whole, as one it
// ignores; a well-formed range past the end is unsatisfiable
export const parseByteRange = (header: string | undefined, size: number): ByteRange => {
  if (header === undefined) {
    return WHOLE;
  }
  const match = SINGLE_RANGE.exec(header.trim());
  const first = match?.groups?.first ?? "";
  const last = match?.groups?.last ?? "";
  if (match === null || (first === "" && last === "")) {
    return WHOLE;
  }
  if (first === "") {
    // a suffix: the last N bytes, all of a file shorter than N
    const suffix = offsetOf(last);
    if (suffix === null) {
      return WHOLE;
    }
    if (suffix === 0 || size === 0) {
      return UNSATISFIABLE;
    }
    return { end: size - 1, kind: "range", start: Math.max(0, size - suffix) };
  }
  const start = offsetOf(first);
  if (start === null) {
    return WHOLE;
  }
  const end = last === "" ? Number.MAX_SAFE_INTEGER : offsetOf(last);
  if (end === null || end < start) {
    // `bytes=5-2` is invalid, which a server ignores
    return WHOLE;
  }
  if (start >= size) {
    return UNSATISFIABLE;
  }
  return { end: Math.min(end, size - 1), kind: "range", start };
};

// an `if-range` names the version the client's earlier pieces came from; one that is not the
// current etag means those pieces are stale, so the answer is the whole file. this server sends no
// last-modified, so a date there names no version of ours and never matches.
export const rangeApplies = (ifRange: string | undefined, etag: string): boolean =>
  ifRange === undefined || ifRange.trim() === etag;
