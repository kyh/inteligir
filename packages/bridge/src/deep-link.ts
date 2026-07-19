// ---------------------------------------------------------------------------
// inteligir:// deep-link grammar — the pure parser + sanitizer behind the
// world-invokable URL scheme (any web page can launch it, so every guard
// lives here where both the host and tests can drive it). Isomorphic: no
// node/electron imports; loads in the renderer, the fixture bridge, and the
// node host alike.
//
// Exactly six verbs (verb = URL hostname, the same parse trick as
// vault-app://): writes `append?text=` / `task?text=` (one sanitized
// plain-text line onto TODAY's daily note — the path is computed host-side,
// NEVER taken from the URL), nav `today` / `note/<target>` / `search?q=`, and
// `session?code=…&state=…` (the social sign-in callback: an OPAQUE single-use
// exchange code — never a raw token — plus the state nonce the desktop minted
// at initiation; both are only ever handed onward, the code to the cloud
// exchange endpoint and the state to the host's pending-sign-in check).
// Anything else parses to null. Oversize input is REJECTED, never truncated.
// ---------------------------------------------------------------------------

import { extnamePath } from "@repo/domain/knowledge/vault-path";
import { isDocPath } from "@repo/domain/knowledge/doc-file";

/** Whole-URL cap — anything longer is dropped unparsed. */
export const MAX_DEEP_LINK_URL_LENGTH = 16_384;
/** Cap on the raw `text=` param of a capture verb (reject, don't truncate). */
export const MAX_CAPTURE_TEXT_LENGTH = 10_000;
/** Cap on the raw `q=` param of the search verb. */
export const MAX_SEARCH_QUERY_LENGTH = 1_000;
/** Cap on a `note/<target>` path or wiki title. */
export const MAX_NOTE_TARGET_LENGTH = 1_024;

/** The session verb's `code`/`state` grammar: opaque base64url-ish tokens,
 * charset- and length-bounded here (the world-invokable surface), but
 * AUTHORITATIVE only server-side — the code buys nothing without the HTTPS
 * exchange, and the state must match the host's one pending sign-in. */
const SESSION_PARAM_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

export type CaptureKind = "append" | "task";

export type DeepLinkNav =
  | { kind: "today" }
  | { kind: "note"; target: string }
  | { kind: "search"; query: string };

/** A nav delivery, id-stamped so the renderer can dedupe the cold-launch
 * overlap between the pushed event and the pulled pending nav. */
export type DeepLinkNavEvent = { id: string; nav: DeepLinkNav };

export type DeepLinkAction =
  | { kind: "capture"; capture: CaptureKind; text: string }
  | { kind: "nav"; nav: DeepLinkNav }
  | { kind: "session"; code: string; state: string };

// The markdown/MDX-active characters a captured line must never smuggle in
// live: `[` (wiki-links, transclusions, images, links), `<` (our MDX
// vocabulary renders <video>/<media_embed> inline), `!` (image/transclusion
// bangs), `$` (math), `#` (tag-index pollution), `` ` `` (inline code /
// fences), `&` (CommonMark decodes numeric character references, so an
// unescaped `&#91;` would round-trip back into `[`), and `\` itself (so the
// escapes can't be escaped away). Backslash-escaping renders clean in Rich
// mode; Raw mode shows the literal `\[` — cosmetic, correct.
const MARKDOWN_ACTIVE = /[\\`[\]<!$#&]/g;

/**
 * Fold untrusted capture text into ONE inert plain-text line: NFC-normalize,
 * collapse all whitespace runs (kills fence/heading/blockquote smuggling —
 * nothing survives at line-start position), strip the remaining C0/C1
 * control characters, then backslash-escape the markdown/MDX-active set.
 * Returns null when nothing printable remains.
 */
export function sanitizeCaptureText(raw: string): string | null {
  const folded = raw
    .normalize("NFC")
    .replaceAll(/\s+/g, " ")
    // C0 + DEL + C1 strip; the whitespace fold above already ate tab/CR/LF.
    // oxlint-disable-next-line no-control-regex -- stripping controls is the point
    .replaceAll(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .trim();
  if (folded === "") return null;
  return folded.replaceAll(MARKDOWN_ACTIVE, (ch) => `\\${ch}`);
}

/** The exact line a capture appends: a bullet, or an unchecked task box that
 * feeds the existing checkbox-delegation surface. */
export function formatCaptureLine(kind: CaptureKind, text: string): string {
  return kind === "task" ? `- [ ] ${text}` : `- ${text}`;
}

/** Append one line at end-of-file, ensuring a separating and a trailing
 * newline. Template-agnostic by design: heading-scoped insertion breaks the
 * moment a user-authored daily template lacks the heading. */
export function appendCaptureLine(content: string, line: string): string {
  if (content === "") return `${line}\n`;
  return content.endsWith("\n") ? `${content}${line}\n` : `${content}\n${line}\n`;
}

/** Exact-full-line membership — the drain's idempotency check, so re-runs
 * (crash drains, ack races) can never append the same capture twice. */
export function hasExactCaptureLine(content: string, line: string): boolean {
  return content.split("\n").includes(line);
}

/**
 * Parse a raw deep-link URL into an action, or null for anything outside the
 * grammar (wrong scheme, unknown verb, missing/oversize/empty params, a
 * `note` target that names a non-doc file — never an HTML App). Capture text
 * comes back already sanitized.
 */
export function parseDeepLink(rawUrl: string): DeepLinkAction | null {
  if (rawUrl.length > MAX_DEEP_LINK_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "inteligir:") return null;
  switch (url.hostname) {
    case "append":
    case "task": {
      const raw = url.searchParams.get("text");
      if (raw === null || raw.length > MAX_CAPTURE_TEXT_LENGTH) return null;
      const text = sanitizeCaptureText(raw);
      if (text === null) return null;
      return { kind: "capture", capture: url.hostname, text };
    }
    case "today":
      return { kind: "nav", nav: { kind: "today" } };
    case "note": {
      let target: string;
      try {
        target = decodeURIComponent(url.pathname).replace(/^\/+/, "").trim();
      } catch {
        return null;
      }
      if (target === "" || target.length > MAX_NOTE_TARGET_LENGTH) return null;
      // Only doc paths may be addressed directly. An extensionless target is
      // a wiki title (the renderer resolves + re-guards it); anything with an
      // extension must be an editable doc — nav must never open an HTML App.
      if (extnamePath(target) !== "" && !isDocPath(target)) return null;
      return { kind: "nav", nav: { kind: "note", target } };
    }
    case "search": {
      const raw = url.searchParams.get("q");
      if (raw === null || raw.length > MAX_SEARCH_QUERY_LENGTH) return null;
      const query = raw.replaceAll(/\s+/g, " ").trim();
      if (query === "") return null;
      return { kind: "nav", nav: { kind: "search", query } };
    }
    case "session": {
      // Social sign-in callback. Both params must fit the opaque grammar —
      // anything else (empty, oversize, wrong charset, smuggled URL syntax)
      // is dropped whole, like every other out-of-grammar URL.
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (code === null || !SESSION_PARAM_PATTERN.test(code)) return null;
      if (state === null || !SESSION_PARAM_PATTERN.test(state)) return null;
      return { kind: "session", code, state };
    }
    default:
      return null;
  }
}
