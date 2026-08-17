// The delegation anchor TOKEN's grammar, alone in its own module because of
// who needs it: the wire contract validates every stored `originAnchor`
// against it, and the contract is bundled into the client. ./thread-marker
// (which finds and places markers) has to parse markdown to do its job;
// pulling the whole remark pipeline into every client that only wants to know
// whether a string is a well-formed token would be a heavy import for a regex.

/** `anc_` + 12 lowercase hex — what the client mints and what a marker in a
 *  file may spell. Exported as a PATTERN string too, so a zod schema can
 *  rebuild it without importing a compiled regex's flags. */
export const THREAD_ANCHOR_TOKEN_PATTERN = "^anc_[0-9a-f]{12}$";

const ANCHOR_TOKEN_RE = new RegExp(THREAD_ANCHOR_TOKEN_PATTERN, "u");

export function isThreadAnchorToken(value: string): boolean {
  return ANCHOR_TOKEN_RE.test(value);
}
