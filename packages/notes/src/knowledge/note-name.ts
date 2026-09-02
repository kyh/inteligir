// Reject, never sanitize: the filename is the title, so silently stripping a
// character would show a title that was never saved.

export type NoteNameReason =
  | "empty"
  | "separator"
  | "illegal-char"
  | "reserved"
  | "dot-edge"
  | "too-long";

export type NoteNameVerdict = { ok: true; name: string } | { ok: false; reason: NoteNameReason };

// windows-illegal punctuation; `/` and `\` are separators, rejected earlier
const ILLEGAL_CHARS = new Set([":", "*", "?", '"', "<", ">", "|"]);

const RESERVED_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// the per-component cap on ext4, apfs and ntfs alike
const MAX_BASENAME_BYTES = 255;

// not TextEncoder: hermes (react native) only recently grew it
function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
  }
  return bytes;
}

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
  // a trailing dot survives trim() and is unrepresentable on windows; a leading dot mints a hidden file the vault crawl skips
  if (name.startsWith(".") || name.endsWith(".")) return { ok: false, reason: "dot-edge" };
  // windows reserves everything before the first dot (`con.tar.gz` too) and ignores trailing spaces there
  const deviceStem = (name.split(".")[0] ?? "").trimEnd();
  if (RESERVED_RE.test(deviceStem)) return { ok: false, reason: "reserved" };
  if (utf8ByteLength(name) > MAX_BASENAME_BYTES) return { ok: false, reason: "too-long" };
  return { ok: true, name };
}

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
