// ---------------------------------------------------------------------------
// A LINE of a markdown file, and THE checkbox grammar over one.
//
// ONE RULE, STATED ONCE: a line's content EXCLUDES its terminator, whichever
// flavor that is (`\r\n`, `\r`, `\n`). Everything downstream rides on it — the
// task scan records a checkbox's `raw` under it, the projection cuts link
// snippets under it — so it is written here and nowhere else. Four copies of
// the split regex is four chances for one of them to disagree, and the one
// that disagrees corrupts a file.
//
// `checkboxMarkerAt` is that same argument for the task-line grammar: the
// editor's click-to-toggle locates the state char through it, the composer's
// checkbox fast path strips the marker through it, and ./task-ordinal counts
// through it — so no surface can accept a task line another surface refuses.
// ---------------------------------------------------------------------------

/** Every line's CONTENT, terminator excluded — the one split rule. A file ending
 * in a terminator yields a trailing empty line, exactly as the byte count says
 * it should. */
export function splitLines(source: string): string[] {
  return source.split(/\r\n|\r|\n/);
}

// The checkbox marker on a GFM task line, split so a caller flipping the state
// touches ONLY that char: (indent + blockquote markers + list marker +
// `[`)(state)`]` followed by whitespace. Bullets, ordered markers (`1.` /
// `2)`), and `> ` prefixes all carry live checkboxes in the editor, so the
// grammar names them all — a narrower one here would refuse a line the editor
// just toggled.
const CHECKBOX_MARKER_RE = /^([ \t]*(?:>[ \t]*)*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])\](?=\s)/;

export type CheckboxMarker = {
  /** Offset of the state char (the byte between `[` and `]`). */
  checkboxIndex: number;
  checked: boolean;
};

/** Locate a task line's state char, or null when the line is not one. */
export function checkboxMarkerAt(lineText: string): CheckboxMarker | null {
  const marker = CHECKBOX_MARKER_RE.exec(lineText);
  const prefix = marker?.[1];
  const state = marker?.[2];
  if (prefix === undefined || state === undefined) return null;
  return { checkboxIndex: prefix.length, checked: state !== " " };
}
