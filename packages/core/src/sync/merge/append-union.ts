// ---------------------------------------------------------------------------
// appendUnion — the 2-way union of two documents that diverged by APPENDING
// (the fork shape this app actually generates: both devices added to today's
// journal, a delegation result landed while the user was typing a capture).
// A port of reflect-open's union algorithm (union.rs): longest common
// line-prefix, then both tails appended — REMOTE tail first, because the
// coordinator committed it earlier, which is the best available chronology
// for a journal.
//
// What makes it safe is the REFUSAL rule: if the tails share any non-blank
// line, this was not a pure append — a mid-note edit puts the note's own
// following lines in both tails — and the function returns `null` so the
// caller falls through to a conflict copy. Whole-tail dedupe only (one side's
// tail empty, or equal tails → the other side verbatim); NEVER per-line
// dedupe, which would corrupt legitimately repeated lines (two identical
// `- [ ] follow up` items).
//
// Pure text → text; the caller (the merge ladder) owns the eligibility gate
// (creation collision, or base a line-prefix of both sides) and all decoding.
// ---------------------------------------------------------------------------

/** `text` split into lines (without terminators) + whether it ended with a
 * newline, so a join can restore the exact trailing shape. CRLF is preserved:
 * only `\n` splits, so a `\r` stays on its line's end and round-trips. */
export function splitLines(text: string): { lines: string[]; trailingNewline: boolean } {
  if (text === "") return { lines: [], trailingNewline: false };
  const trailingNewline = text.endsWith("\n");
  const body = trailingNewline ? text.slice(0, -1) : text;
  return { lines: body.split("\n"), trailingNewline };
}

/** True when `line` is blank (empty or whitespace-only, `\r` included). */
function isBlank(line: string): boolean {
  return line.trim() === "";
}

/** `lines` without its trailing blank run. */
function trimTrailingBlanks(lines: readonly string[]): readonly string[] {
  let end = lines.length;
  while (end > 0 && isBlank(lines[end - 1] ?? "")) end -= 1;
  return lines.slice(0, end);
}

function tailsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

/**
 * Union-merge two line-divergent documents, or `null` when the divergence is
 * not append-shaped (overlapping tails). Argument order encodes tail order:
 * the REMOTE tail is emitted first (coordinator-committed-earlier).
 */
export function appendUnion(remote: string, local: string): string | null {
  const r = splitLines(remote);
  const l = splitLines(local);

  // Longest common line-prefix.
  let split = 0;
  while (split < r.lines.length && split < l.lines.length && r.lines[split] === l.lines[split]) {
    split += 1;
  }
  const prefix = r.lines.slice(0, split);
  const remoteTail = trimTrailingBlanks(r.lines.slice(split));
  const localTail = trimTrailingBlanks(l.lines.slice(split));

  // Whole-tail dedupe: one side added nothing (or only trailing blanks), or
  // both added the identical tail → the remote side verbatim (byte-equal to
  // the coordinator, so the caller's hash short-circuit skips the push).
  if (remoteTail.length === 0 && localTail.length === 0) return remote;
  if (tailsEqual(remoteTail, localTail)) return remote;
  if (remoteTail.length === 0) return local;
  if (localTail.length === 0) return remote;

  // Refuse on tail overlap: a shared non-blank line means both tails contain
  // the note's own following text — a mid-note edit, not an append.
  const remoteTailLines = new Set(remoteTail.filter((line) => !isBlank(line)));
  if (localTail.some((line) => !isBlank(line) && remoteTailLines.has(line))) return null;

  const merged = [...prefix, ...remoteTail, ...localTail];
  return merged.join("\n") + (r.trailingNewline || l.trailingNewline ? "\n" : "");
}
