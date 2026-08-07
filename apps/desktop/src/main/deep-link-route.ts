// ---------------------------------------------------------------------------
// Pure `inteligir://` → hosted-route translation. No electron import —
// deep-link.ts owns the OS glue (the open-url listener, the scheme
// registration, the pre-window buffer) and delegates the DECISION here, so the
// grammar is unit-testable without an Electron env.
//
// The shell owns no vault and no inbox, so it cannot ACT on a link; all it can
// do is hand one to the page. That means validating the URL against the
// scheme's one grammar (@repo/bridge/deep-link — the same parser the host
// runs), then re-emitting it as `/app/link?verb=…`, which is where the client
// reads it.
//
// Re-emitted from the PARSED verb with a named parameter each, never by
// forwarding the query whole: a URL any web page can launch must not be able
// to smuggle a parameter through this process into a route it was not meant
// for. The parameter VALUES pass through raw on purpose — the page's own parse
// is the authoritative one, and sanitizing here would double-escape what it
// sanitizes again.
//
// `session` is dropped rather than translated. It completed a social sign-in
// for a host that had minted the state nonce; this shell holds no session, the
// page it loads signs in for itself, and forwarding it would be a second,
// weaker way to become authenticated.
// ---------------------------------------------------------------------------

import { parseDeepLink } from "@repo/bridge/deep-link";

export const DEEP_LINK_SCHEME = "inteligir";

/** The route the client answers deep links on. */
const LINK_PATH = "/app/link";

/**
 * The hosted-app path a raw `inteligir://` URL should open, or null when the
 * URL is outside the grammar or names a verb the web has no answer for.
 */
export function deepLinkPath(rawUrl: string): string | null {
  const action = parseDeepLink(rawUrl);
  if (action === null || action.kind === "session") return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const params = new URLSearchParams();
  if (action.kind === "capture") {
    params.set("verb", action.capture);
    params.set("text", url.searchParams.get("text") ?? "");
  } else {
    switch (action.nav.kind) {
      case "today":
        params.set("verb", "today");
        break;
      case "note":
        params.set("verb", "note");
        params.set("target", action.nav.target);
        break;
      case "search":
        params.set("verb", "search");
        params.set("q", url.searchParams.get("q") ?? "");
        break;
    }
  }
  return `${LINK_PATH}?${params.toString()}`;
}

/** The first inteligir:// URL on an argv, or null — the win/linux delivery
 * (second-instance and cold-launch argv both carry it). */
export function extractDeepLinkFromArgv(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${DEEP_LINK_SCHEME}://`)) ?? null;
}
