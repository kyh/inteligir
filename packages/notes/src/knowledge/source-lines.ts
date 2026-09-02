// The one split rule: a line's content excludes its terminator, any of `\r\n`,
// `\r`, `\n`. ../text/line-diff splits on LF alone on purpose.
export function splitLines(source: string): string[] {
  return source.split(/\r\n|\r|\n/);
}
