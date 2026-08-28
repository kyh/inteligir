// ---------------------------------------------------------------------------
// A LINE of a markdown file.
//
// ONE RULE, STATED ONCE: a line's content EXCLUDES its terminator, whichever
// flavor that is (`\r\n`, `\r`, `\n`). Everything downstream rides on it — the
// task scan reads a checkbox's text under it, the projection cuts link
// snippets under it, the SQL store cuts search excerpts under it — so it is
// written here and nowhere else. Four copies of the split regex is four
// chances for one of them to disagree, and the one that disagrees corrupts a
// file. (../text/line-diff splits on LF ALONE, and says there why it is not
// this rule.)
// ---------------------------------------------------------------------------

/** Every line's CONTENT, terminator excluded — the one split rule. A file ending
 * in a terminator yields a trailing empty line, exactly as the byte count says
 * it should. */
export function splitLines(source: string): string[] {
  return source.split(/\r\n|\r|\n/);
}
