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

const ILLEGAL_CHARS = new Set([":", "*", "?", '"', "<", ">", "|"]);

const BRACKETS = new Set(["[", "]"]);

const RESERVED_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

const MAX_BASENAME_BYTES = 255;

export const checkNoteName = (raw: string) => {
  const name = raw.normalize("NFC").trim();

  if (name === "") {
    return { ok: false, reason: "empty" } satisfies NoteNameVerdict;
  }

  for (const ch of name) {
    if (ch === "/" || ch === "\\") {
      return { ok: false, reason: "separator" } satisfies NoteNameVerdict;
    }

    const cp = ch.codePointAt(0) ?? 0;

    if (cp < 0x20 || cp === 0x7f || ILLEGAL_CHARS.has(ch)) {
      return { ok: false, reason: "illegal-char" } satisfies NoteNameVerdict;
    }

    if (BRACKETS.has(ch)) {
      return { ok: false, reason: "bracket" } satisfies NoteNameVerdict;
    }
  }

  if (name.startsWith(".") || name.endsWith(".")) {
    return { ok: false, reason: "dot-edge" } satisfies NoteNameVerdict;
  }

  const deviceStem = (name.split(".")[0] ?? "").trimEnd();

  if (RESERVED_RE.test(deviceStem)) {
    return { ok: false, reason: "reserved" } satisfies NoteNameVerdict;
  }

  if (utf8ByteLength(name) > MAX_BASENAME_BYTES) {
    return { ok: false, reason: "too-long" } satisfies NoteNameVerdict;
  }

  return { name, ok: true } satisfies NoteNameVerdict;
};
