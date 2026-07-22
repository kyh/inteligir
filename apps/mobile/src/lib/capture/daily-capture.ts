// ---------------------------------------------------------------------------
// Mobile quick capture — the 5-second "append one line onto TODAY's daily
// note" path behind the home screen's capture box. Pure string+date math over
// an injected `CaptureIo`, so it unit-tests in node (the expo-backed adapter
// lives in capture-io.ts). Path + line formatting are REUSED from the shared
// helpers (`@repo/notes/daily-path`, `@repo/bridge/daily-notes`,
// `@repo/bridge/deep-link`), so a phone capture lands byte-compatible with
// the desktop capture drain — which is exactly what lets concurrent
// phone+desktop captures of the same journal merge through the sync engine's
// append-union rung instead of forking into a conflict copy.
//
// Concurrency: read → append → write is ONE synchronous JS turn (no awaits),
// so nothing on this device can interleave — unlike the desktop drain, which
// needs a CAS against cross-process writers (agent, autosave). Cross-DEVICE
// concurrency is the merge ladder's job, not this module's.
// ---------------------------------------------------------------------------

import { dailyNotePath, formatIsoDate } from "@repo/notes/daily-path";
import { titleFromPath } from "@repo/notes/knowledge/link-extract";
import {
  DAILY_TEMPLATE_PATH,
  DEFAULT_DAILY_FOLDER,
  DEFAULT_DAILY_FORMAT,
  applyTemplate,
} from "@repo/bridge/daily-notes";
import { appendCaptureLine, formatCaptureLine, type CaptureKind } from "@repo/bridge/deep-link";

/** The two vault operations a capture needs. Both SYNCHRONOUS — the
 * one-JS-turn interleaving guarantee above depends on it. */
export type CaptureIo = {
  /** Raw file text, or null when the file doesn't exist. */
  read: (path: string) => string | null;
  /** Write text, creating parent directories as needed. */
  write: (path: string, text: string) => void;
};

export type CaptureResult =
  | { readonly kind: "appended"; readonly path: string; readonly line: string }
  | { readonly kind: "empty" };

/**
 * Fold capture-box input into ONE plain line: NFC-normalize, collapse every
 * whitespace run (a pasted multi-line snippet becomes one line — the capture
 * contract is a single bullet), strip the remaining C0/C1 control characters,
 * trim. Null when nothing printable remains.
 *
 * Deliberately NOT `sanitizeCaptureText` (@repo/bridge/deep-link): that also
 * backslash-escapes the markdown-active set, which is right for UNTRUSTED
 * cross-app deep-link text but would destroy the `#tags` and `[[links]]` a
 * user types into their own capture box on purpose. First-party input keeps
 * its markdown.
 */
export function foldCaptureText(raw: string): string | null {
  const collapsed = raw.normalize("NFC").replaceAll(/\s+/g, " ");
  // C0 + DEL + C1 strip by codepoint scan (a control-char regex range trips
  // oxlint's no-control-regex; the scan reads clearer anyway). The whitespace
  // fold above already ate tab/CR/LF.
  let folded = "";
  for (const ch of collapsed) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    if (!isControl) folded += ch;
  }
  const trimmed = folded.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Today's daily-note path on MOBILE. Mobile has no Settings → Notes surface
 * yet, so this uses the shared DEFAULTS (`journal/`, `YYYY-MM-DD`) from
 * `@repo/bridge/daily-notes` — the same constants the desktop capture drain
 * falls back to when ui-state carries no override. KNOWN DIVERGENCE: the
 * daily folder/format config lives in desktop ui-state and does not travel,
 * so a user who customized it on desktop captures here into the DEFAULT path.
 * A mobile setting (or config sync) is the follow-up; until then the default
 * is imported from the one shared definition, never duplicated.
 */
export function todayDailyNotePath(now: Date): string {
  return dailyNotePath(DEFAULT_DAILY_FOLDER, DEFAULT_DAILY_FORMAT, now);
}

/** A missing daily note is seeded from `templates/daily.md` (placeholders
 * applied) when the template synced to this device — so a phone-created daily
 * is identical to a ⌘D- or drain-created one. No template → empty seed. */
function seedContent(io: CaptureIo, path: string, now: Date): string {
  const template = io.read(DAILY_TEMPLATE_PATH);
  if (template === null) return "";
  return applyTemplate(template, { title: titleFromPath(path), date: formatIsoDate(now) });
}

/**
 * Append one capture onto today's daily note: fold the text, format the line
 * (`- …` / `- [ ] …` — the desktop capture format), append with the shared
 * newline discipline, write back through the vault fs the sync engine
 * reconciles. No dedupe on purpose: unlike the desktop drain (whose crash
 * re-runs need exactly-once), this runs once per tap, and a deliberately
 * repeated capture (`- [ ] follow up` twice) must land twice.
 */
export function appendCapture(
  io: CaptureIo,
  kind: CaptureKind,
  rawText: string,
  now: Date,
): CaptureResult {
  const text = foldCaptureText(rawText);
  if (text === null) return { kind: "empty" };
  const path = todayDailyNotePath(now);
  const line = formatCaptureLine(kind, text);
  const base = io.read(path) ?? seedContent(io, path, now);
  io.write(path, appendCaptureLine(base, line));
  return { kind: "appended", path, line };
}
