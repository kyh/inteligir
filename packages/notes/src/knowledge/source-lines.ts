// The one split rule: a line's content excludes its terminator, any of `\r\n`,
// `\r`, `\n`. ../text/line-diff splits on LF alone on purpose.
const LINE_TERMINATOR = /\r\n|\r|\n/u;

export function splitLines(source: string): string[] {
  return source.split(LINE_TERMINATOR);
}

// lines at the even indexes and the terminator that ended each at the odd ones, so a
// per-line rewrite joins back byte-exact
export function splitLinesKeepingTerminators(source: string): string[] {
  return source.split(new RegExp(`(${LINE_TERMINATOR.source})`, "u"));
}
