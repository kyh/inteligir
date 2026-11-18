import { getSessionCookie } from "better-auth/cookies";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { CONNECTOR_CONSENT_PATH } from "@repo/contract/connector";
import { LIBRARY_PAGE_PATH } from "@repo/contract/library-page";

import { prefersMarkdown } from "#lib/content-negotiation";
import { libraryPolicy, mintNonce } from "#lib/document-policy";
import { signInHref } from "#lib/next-path";

// The documents rendered per request, exactly: a path under them nothing serves falls to the
// prerendered 404, whose scripts carry no nonce and would be refused under this policy. The
// matcher below spells the same list, since Next reads it as a literal.
const NONCE_DOCUMENTS: ReadonlySet<string> = new Set([
  LIBRARY_PAGE_PATH,
  `${LIBRARY_PAGE_PATH}/settings`,
  "/app/sign-in",
  "/app/sign-up",
  "/app/forgot-password",
  "/app/reset-password",
  CONNECTOR_CONSENT_PATH,
]);

const SIGNED_IN_ONLY = (pathname: string): boolean =>
  pathname === LIBRARY_PAGE_PATH || pathname.startsWith(`${LIBRARY_PAGE_PATH}/`);

// a page that answers markdown names this route, which a client asking for HTML never reaches
const MARKDOWN_ROUTE = "/api/markdown";

/**
 * A signed-in page asked for with no session cookie goes to sign in and back before anything
 * renders. The cookie alone, with no read of its session: that would spend a database read on
 * every such document, and a cookie whose session ended is the page's to find. A document rendered
 * per request gets this request's nonce, which Next reads off the request's policy and writes on
 * every script of its own. Markdown is negotiated here because a server component renders HTML
 * whatever was asked.
 */
export const proxy = (request: NextRequest) => {
  const { nextUrl } = request;

  if (NONCE_DOCUMENTS.has(nextUrl.pathname)) {
    if (SIGNED_IN_ONLY(nextUrl.pathname) && getSessionCookie(request) === null) {
      return NextResponse.redirect(new URL(signInHref(nextUrl), nextUrl), 307);
    }
    const nonce = mintNonce();
    const policy = libraryPolicy(nextUrl, nonce);
    const headers = new Headers(request.headers);
    headers.set("content-security-policy", policy);
    headers.set("x-nonce", nonce);
    const response = NextResponse.next({ request: { headers } });
    response.headers.set("content-security-policy", policy);
    return response;
  }

  // the markdown route varies its own answer by Accept
  if (prefersMarkdown(request.headers.get("accept"))) {
    return NextResponse.rewrite(
      new URL(`${MARKDOWN_ROUTE}${nextUrl.pathname === "/" ? "" : nextUrl.pathname}`, nextUrl),
    );
  }
  // the page for a client that named markdown and ranks HTML first, which a cache keyed on the URL
  // alone would otherwise hand the next client whatever it asked
  const response = NextResponse.next();
  response.headers.append("vary", "Accept");
  return response;
};

/**
 * The markdown row runs only for an Accept naming markdown, so a browser's page never pays for the
 * proxy; it leaves out every route that answers for itself and every file. Case-insensitivity is
 * spelled per character: Next and Vercel compile `has` to regexes with no shared inline flag.
 */
export const config = {
  matcher: [
    "/library",
    "/library/settings",
    "/app/sign-in",
    "/app/sign-up",
    "/app/forgot-password",
    "/app/reset-password",
    "/connect/authorize",
    {
      has: [{ key: "accept", type: "header", value: ".*[Mm][Aa][Rr][Kk][Dd][Oo][Ww][Nn].*" }],
      source:
        "/((?!api/|v1/|eve/|connector|connect/|oauth/|\\.well-known/|_next/|_vercel/|favicon/|og/|og\\.jpg$|licenses|robots\\.txt$|sitemap\\.xml$|llms\\.txt$).*)",
    },
  ],
};
