// ---------------------------------------------------------------------------
// Note-name validation — the pure gate every user-named file goes through:
// the page-title <h1> rename, wiki create-on-complete, and the palette's "new
// note". In inteligir the filename IS the title (no slug layer), so the rule
// is REJECT, never sanitize: the name on disk is exactly what the user typed,
// or they get told why not. Silent stripping would show a title that was
// never saved.
//
// Callers pass the full BASENAME (title plus extension when they have one):
// the extension participates in the byte cap, while the reserved-device check
// is extension-blind (Windows semantics — `con.md` is as unusable as `con`).
//
// The reject-set targets the strictest common filesystems (NTFS + APFS +
// sync/export targets) and is FROZEN by the golden corpus in
// packages/notes/src/__tests__/note-name.test.ts — changing a verdict there is
// a deliberate breaking-change gate, not a refactor detail.
//
// Platform-neutral: runs in the renderer (instant feedback) and the host
// (boundary enforcement) from the same bytes.
// ---------------------------------------------------------------------------

export type NoteNameReason =
  | "empty"
  | "separator"
  | "illegal-char"
  | "reserved"
  | "dot-edge"
  | "too-long";

/** The verdict: `ok` carries the NFC-normalized, trimmed name to use verbatim
 * as the filename; a rejection carries the machine reason (map it to copy via
 * `noteNameErrorMessage`). */
export type NoteNameVerdict = { ok: true; name: string } | { ok: false; reason: NoteNameReason };

// Windows-illegal punctuation (`/` and `\` are rejected earlier, as
// separators — a `/` in a title would silently create folders).
const ILLEGAL_CHARS = new Set([":", "*", "?", '"', "<", ">", "|"]);

// Windows reserved device names, case-insensitive, extension-blind.
const RESERVED_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Ubiquitous per-component filename cap (ext4/APFS/NTFS): 255 bytes UTF-8. */
const MAX_BASENAME_BYTES = 255;

/** UTF-8 byte length without TextEncoder (which React Native's Hermes only
 * grew recently) — code-point arithmetic is exact and everywhere. */
function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
  }
  return bytes;
}

/** Validate a would-be note basename. NFC-normalizes and trims first (so the
 * accepted `name` is canonical); then rejects, in this order: empty,
 * path separators, Windows-illegal punctuation + control chars, leading dot /
 * trailing dot (hidden files, Windows-unrepresentable names), reserved device
 * names, and the 255-byte cap. */
export function checkNoteName(raw: string): NoteNameVerdict {
  const name = raw.normalize("NFC").trim();
  if (name === "") return { ok: false, reason: "empty" };
  for (const ch of name) {
    if (ch === "/" || ch === "\\") return { ok: false, reason: "separator" };
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x20 || cp === 0x7f || ILLEGAL_CHARS.has(ch)) {
      return { ok: false, reason: "illegal-char" };
    }
  }
  // trim() already removed trailing spaces; a trailing dot survives it and is
  // unrepresentable on Windows. A leading dot would mint a hidden file the
  // vault crawl itself skips.
  if (name.startsWith(".") || name.endsWith(".")) return { ok: false, reason: "dot-edge" };
  // Extension-blind: everything before the FIRST dot is the device-name part
  // (`con.tar.gz` is reserved); Windows also ignores trailing spaces there.
  const deviceStem = (name.split(".")[0] ?? "").trimEnd();
  if (RESERVED_RE.test(deviceStem)) return { ok: false, reason: "reserved" };
  if (utf8ByteLength(name) > MAX_BASENAME_BYTES) return { ok: false, reason: "too-long" };
  return { ok: true, name };
}

/** One user-facing sentence per rejection — shared by the renderer toast and
 * the host handler's `{ ok: false, error }` so the copy never forks. */
export function noteNameErrorMessage(reason: NoteNameReason): string {
  switch (reason) {
    case "empty":
      return "Note names can't be empty.";
    case "separator":
      return "Note names can't contain / or \\.";
    case "illegal-char":
      return "Note names can't contain : * ? \" < > | or control characters.";
    case "reserved":
      return "That name is reserved on Windows (CON, PRN, AUX, NUL, COM1–9, LPT1–9).";
    case "dot-edge":
      return "Note names can't start with a dot or end with a dot.";
    case "too-long":
      return "That name is too long (255 bytes max).";
  }
}
