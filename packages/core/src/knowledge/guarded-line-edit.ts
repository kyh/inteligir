// ---------------------------------------------------------------------------
// Guarded surgical line edits — the WRITE-side counterpart of find-task-line's
// read-side guard. A caller that recorded a line's exact bytes (the
// projection's ExtractedTask.raw) can replace that one line iff the file still
// carries those bytes at the addressed spot; any drift is a refusal VALUE,
// never a silent wrong write and never a throw.
//
// EOL contract (shared with the projection): a line's `raw` is its content
// EXCLUDING the terminator (`\r\n`, `\r`, or `\n`) — the same split rule
// knowledge-index/projection use — and the splice never touches terminator
// bytes, so CRLF and even mixed-EOL files survive byte-exactly.
//
// Addressing: `replaceLineGuarded`/`toggleCheckboxLine` take a raw LINE index
// (position-addressed); `toggleTaskAtOrdinal` is the primitive the toggle
// surfaces use — it locates the ordinal-th GFM task item (find-task-line's
// counting contract, content-addressed) and THEN requires raw-byte equality,
// so an insert above the item retargets correctly and a duplicate identical
// line elsewhere can never steal the write.
// ---------------------------------------------------------------------------

import { scanTaskItems } from "./link-extract";

export type LineEditResult = { ok: true; content: string } | LineEditFailure;

export type LineEditFailure = {
  ok: false;
  reason: "line-missing" | "line-changed";
};

export type CheckboxToggleResult =
  | { ok: true; content: string; checked: boolean }
  | CheckboxToggleFailure;

export type CheckboxToggleFailure = {
  ok: false;
  reason: "line-missing" | "line-changed" | "not-a-checkbox";
};

/** The `[start, end)` span of the 0-based `lineIndex`-th line's content —
 * terminator excluded — or null when the file has fewer lines. Scans EOLs in
 * place (never split/join) so the caller can splice within the original
 * string and every untouched byte, CRLF terminators included, survives. */
function lineSpan(source: string, lineIndex: number): { start: number; end: number } | null {
  if (lineIndex < 0) return null;
  let start = 0;
  for (let line = 0; line < lineIndex; line++) {
    let i = start;
    while (i < source.length && source.charAt(i) !== "\n" && source.charAt(i) !== "\r") i++;
    if (i >= source.length) return null; // ran out of lines before lineIndex
    // Step over the terminator: \r\n counts as ONE.
    i += source.charAt(i) === "\r" && source.charAt(i + 1) === "\n" ? 2 : 1;
    start = i;
  }
  let end = start;
  while (end < source.length && source.charAt(end) !== "\n" && source.charAt(end) !== "\r") end++;
  return { start, end };
}

/** Replace the 0-based `lineIndex`-th line iff its current content (terminator
 * excluded) equals `expectedRaw` byte-for-byte. Byte-splice within the
 * original string — terminators are never rewritten, so CRLF survives. */
export function replaceLineGuarded(
  source: string,
  lineIndex: number,
  expectedRaw: string,
  replacement: string,
): LineEditResult {
  const span = lineSpan(source, lineIndex);
  if (span === null) return { ok: false, reason: "line-missing" };
  if (source.slice(span.start, span.end) !== expectedRaw) {
    return { ok: false, reason: "line-changed" };
  }
  return { ok: true, content: source.slice(0, span.start) + replacement + source.slice(span.end) };
}

// The checkbox marker on a task line, split so the flip touches ONLY the
// state char: (indent + bullet + `[`)(state)(`]`) followed by whitespace.
const CHECKBOX_MARKER_RE = /^(\s*[-*+]\s+\[)([ xX])(\])(?=\s)/;

/** Flip the checkbox state char of the 0-based `lineIndex`-th line, guarded by
 * `expectedRaw` exactly like `replaceLineGuarded`. Only the single marker char
 * changes (`[ ]`→`[x]`; `[x]`/`[X]`→`[ ]`); `checked` reports the NEW state. */
export function toggleCheckboxLine(
  source: string,
  lineIndex: number,
  expectedRaw: string,
): CheckboxToggleResult {
  const marker = CHECKBOX_MARKER_RE.exec(expectedRaw);
  const prefix = marker?.[1];
  const state = marker?.[2];
  if (marker === null || prefix === undefined || state === undefined) {
    return { ok: false, reason: "not-a-checkbox" };
  }
  const checked = state === " "; // flipping: unchecked becomes checked
  const flipped = prefix + (checked ? "x" : " ") + expectedRaw.slice(prefix.length + state.length);
  const replaced = replaceLineGuarded(source, lineIndex, expectedRaw, flipped);
  if (!replaced.ok) return replaced;
  return { ok: true, content: replaced.content, checked };
}

/** Toggle the `ordinal`-th GFM task item (find-task-line's counting contract,
 * frontmatter-aware and code-fence-safe) after verifying its current source
 * line equals `expectedRaw`. Content-addressed: lines shifting above the item
 * relocate it by ordinal, while any edit to the line itself — or a different
 * task landing at the ordinal — refuses with `line-changed`. */
export function toggleTaskAtOrdinal(
  source: string,
  ordinal: number,
  expectedRaw: string,
): CheckboxToggleResult {
  const task = scanTaskItems(source).find((item) => item.ordinal === ordinal);
  if (task === undefined) return { ok: false, reason: "line-missing" };
  if (task.raw !== expectedRaw) return { ok: false, reason: "line-changed" };
  return toggleCheckboxLine(source, task.line - 1, expectedRaw);
}
