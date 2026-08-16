// ---------------------------------------------------------------------------
// A LINE of a markdown file — and the guarded, byte-exact way to rewrite one.
//
// ONE RULE, STATED ONCE: a line's content EXCLUDES its terminator, whichever
// flavor that is (`\r\n`, `\r`, `\n`). Everything downstream rides on it — the
// task scan records a checkbox's `raw` under it, the projection cuts link
// snippets under it, and the guarded write below compares against it — so it is
// written here and nowhere else. Four copies of the split regex is four chances
// for one of them to disagree, and the one that disagrees corrupts a file.
//
// TWO READINGS OF THAT RULE LIVE HERE TOGETHER, because they have to agree:
// `splitLines` reads lines as VALUES, `lineSpan` reads one as a POSITION. The
// split is the convenient one and cannot be used to write: joining back would
// rewrite every terminator in the file, so a CRLF doc saved after ticking one
// box would come back with every line changed. So the write side scans EOLs in
// place and splices INSIDE the span — no untouched byte moves, mixed EOLs
// included. Their agreement is pinned by __tests__/source-lines.test.ts.
//
// Addressing: `replaceLineGuarded`/`toggleCheckboxLine` take a raw LINE index.
// Content-addressed callers go through ./task-ordinal, which resolves an ordinal
// to a line first and then requires raw-byte equality here.
// ---------------------------------------------------------------------------

export type LineEditResult = { ok: true; content: string } | LineEditFailure;

type LineEditFailure = {
  ok: false;
  reason: "line-missing" | "line-changed";
};

export type CheckboxToggleResult =
  | { ok: true; content: string; checked: boolean }
  | CheckboxToggleFailure;

type CheckboxToggleFailure = {
  ok: false;
  reason: "line-missing" | "line-changed" | "not-a-checkbox";
};

/** Every line's CONTENT, terminator excluded — the one split rule. A file ending
 * in a terminator yields a trailing empty line, exactly as the byte count says
 * it should. */
export function splitLines(source: string): string[] {
  return source.split(/\r\n|\r|\n/);
}

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
