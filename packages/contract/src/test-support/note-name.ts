// A name every disk takes and a `[[link]]` can name, the oracle the suites hold the names an
// export writes to: it rejects, never sanitizes, so a name it accepts is the name as written.

import { utf8ByteLength } from "../library/canonical-json";

type NoteNameReason =
  | "empty"
  | "separator"
  | "illegal-char"
  | "bracket"
  | "reserved"
  | "dot-edge"
  | "too-long";

export type NoteNameVerdict = { ok: true; name: string } | { ok: false; reason: NoteNameReason };

// windows-illegal punctuation; `/` and `\` are separators, rejected earlier
const ILLEGAL_CHARS = new Set([":", "*", "?", '"', "<", ">", "|"]);

// legal on every disk, but a bracket ends a `[[link]]`, so no link could name the note
const BRACKETS = new Set(["[", "]"]);

const RESERVED_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

// the per-component cap on ext4, apfs and ntfs alike
const MAX_BASENAME_BYTES = 255;

export const checkNoteName = (raw: string): NoteNameVerdict => {
  const name = raw.normalize("NFC").trim();
  if (name === "") {
    return { ok: false, reason: "empty" };
  }
  for (const ch of name) {
    if (ch === "/" || ch === "\\") {
      return { ok: false, reason: "separator" };
    }
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x20 || cp === 0x7f || ILLEGAL_CHARS.has(ch)) {
      return { ok: false, reason: "illegal-char" };
    }
    if (BRACKETS.has(ch)) {
      return { ok: false, reason: "bracket" };
    }
  }
  // a trailing dot survives trim() and is unrepresentable on windows; a leading dot names a hidden
  // file an import skips
  if (name.startsWith(".") || name.endsWith(".")) {
    return { ok: false, reason: "dot-edge" };
  }
  // windows reserves everything before the first dot (`con.tar.gz` too) and ignores trailing spaces there
  const deviceStem = (name.split(".")[0] ?? "").trimEnd();
  if (RESERVED_RE.test(deviceStem)) {
    return { ok: false, reason: "reserved" };
  }
  if (utf8ByteLength(name) > MAX_BASENAME_BYTES) {
    return { ok: false, reason: "too-long" };
  }
  return { name, ok: true };
};
