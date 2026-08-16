// ---------------------------------------------------------------------------
// `inteligir://` as an HTTPS route, with the grammar untouched.
//
// This scheme is WORLD-INVOKABLE: anyone can link to `/capture?…`, exactly as
// anyone can launch an `inteligir://` URL. So every guard lives in the pure
// parser (`@repo/bridge/deep-link`), where both the host and its tests can
// drive it, and this module's whole job is to turn the query a browser carried
// into the URL that parser already knows how to refuse — reusing it VERBATIM
// rather than re-expressing it for a second shape.
//
// The six verbs are unchanged, and so are their answers here:
//
//   append | task     enqueue one sanitized line (../capture/capture-inbox)
//   today | note | search   a nav, pushed and parked for a client that has not
//                           subscribed yet
//   session           REFUSED. It completed a DESKTOP social sign-in by handing
//                     an exchange code to a host that had minted the state
//                     nonce. A web client is already signed in — the session is
//                     what named this Durable Object — so there is nothing here
//                     to complete, and accepting it would be a second, weaker
//                     way to become authenticated.
//
// The capture verbs never carry a path, and this is where that is enforced by
// construction rather than by review: nothing below reads a target out of the
// URL, and the inbox resolves today's note from the user's own Settings.
// ---------------------------------------------------------------------------

import { parseDeepLink, type DeepLinkAction } from "@repo/bridge/deep-link";

/** Verbs the HTTP route accepts, spelled as the URL's own first segment so
 * `/capture/append?text=…` reads the way the scheme did. */
const HTTP_VERBS = ["append", "task", "today", "note", "search"] as const;

/**
 * Translate a web deep link into the scheme grammar and parse it, or `null` for
 * anything outside it.
 *
 * `verb` and `query` arrive separately because that is how a route has them,
 * and re-joining them here is what keeps `parseDeepLink` the single authority
 * on caps, charsets, sanitization and the doc-path rule. A verb this surface
 * does not serve — `session` — is refused BEFORE the parse rather than after,
 * so its parameters are never even read.
 */
export function parseWebDeepLink(verb: string, query: URLSearchParams): DeepLinkAction | null {
  if (!HTTP_VERBS.some((allowed) => allowed === verb)) return null;
  // `note` addresses its target in the PATH on the scheme side; the web form
  // carries it as a parameter, so it is re-encoded into the shape the parser
  // reads. Encoded, not interpolated: a target containing `?` or `#` would
  // otherwise re-parse as query syntax.
  const target = query.get("target");
  const path = verb === "note" && target !== null ? `/${encodeURIComponent(target)}` : "";
  const rest = query.toString();
  return parseDeepLink(`inteligir://${verb}${path}${rest === "" ? "" : `?${rest}`}`);
}
