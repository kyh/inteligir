import { eq, lt } from "drizzle-orm";
import { createAuth } from "./auth";
import { createDb } from "../db/client";
import { desktopAuthCode } from "../db/schema";
import { sha256Hex } from "../hash";
import { allowInWindow, callerIp, type RateWindow } from "../rate-limit";

// ---------------------------------------------------------------------------
// Desktop social-login handoff — the authorization-code pattern over the
// world-invokable `inteligir://` scheme. The deep link must NEVER carry a raw
// session/bearer token (any app or web page can fire one at the desktop), so
// the browser→app handoff goes:
//
//   1. The desktop initiates `signIn.social` with
//      `callbackURL=/v1/auth/desktop-callback?state=<nonce>` and opens the
//      returned authorization URL in the system browser.
//   2. Better Auth completes OAuth at /api/auth/callback/:provider, creates
//      the session, sets the session COOKIE, and 302s to the callbackURL.
//   3. `GET /v1/auth/desktop-callback` (here) validates that cookie session,
//      mints a SHORT-LIVED (90s) SINGLE-USE high-entropy code bound to it
//      (stored hashed in D1), and serves an interstitial that launches
//      `inteligir://session?code=<code>&state=<state>` — code only, no token.
//   4. `POST /v1/auth/exchange` (here) burns the code atomically
//      (DELETE … RETURNING) and returns the session bearer + email over HTTPS.
//
// The `state` nonce is minted BY THE DESKTOP at initiation and merely echoed
// through (charset-checked): the desktop refuses any `session` deep link whose
// state doesn't match its one pending sign-in, which kills drive-by session
// fixation (an attacker deep-linking their own freshly minted code into a
// victim's app to make the victim's vault sync into the attacker's account).
//
// The bearer we return is the RAW session token (`session.token` from
// getSession): the bearer() plugin accepts unsigned tokens (no `.`) when
// `requireSignature` is off — it re-signs and verifies them itself — so this
// is the same credential shape email sign-in's `set-auth-token` establishes.
// ---------------------------------------------------------------------------

/** Code lifetime — long enough for the browser→app handoff, short enough that
 * a leaked interstitial URL goes stale before it can be replayed usefully. */
const CODE_TTL_MS = 90_000;
/** 32 random bytes → a 43-char base64url code (~256 bits of entropy). */
const CODE_BYTES = 32;
/** The opaque-token grammar shared with the desktop's deep-link parser: the
 * code we mint and the state the desktop mints both stay inside it, so the
 * interstitial can embed them in a URL/HTML with no escaping concerns. */
const OPAQUE_PARAM = /^[A-Za-z0-9_-]{16,256}$/;

/** Exchange rate limit — same fixed-window shape (and `rate_limit` D1 table)
 * as Better Auth's own limiter: 10 attempts / 60s per IP. */
const EXCHANGE_WINDOW: RateWindow = { max: 10, windowMs: 60_000 };
const EXCHANGE_RATE_KEY_PREFIX = "desktop-exchange:";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function hashCode(code: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(code));
}

/** The interstitial the OAuth flow lands on. `deepLink` (already validated to
 * the opaque grammar) is launched immediately and offered as a manual button;
 * null renders the failure copy. `no-store` because the page embeds the code. */
function interstitial(deepLink: string | null, message: string): Response {
  const action =
    deepLink === null
      ? ""
      : `<p><a class="button" href="${deepLink}">Open inteligir</a></p>` +
        `<script>location.replace("${deepLink}");</script>`;
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>inteligir sign-in</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; background: #fafafa; color: #1a1a1a; }
  main { text-align: center; padding: 2rem; }
  .button { display: inline-block; padding: 0.5rem 1.25rem; border-radius: 8px; background: #1a1a1a; color: #fff; text-decoration: none; }
  p.dim { color: #6b6b6b; font-size: 13px; }
</style>
</head>
<body><main><p>${message}</p>${action}<p class="dim">You can close this tab.</p></main></body>
</html>`;
  return new Response(body, {
    status: deepLink === null ? 400 : 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // The success page embeds the one-time code — never cache it anywhere.
      "cache-control": "no-store",
    },
  });
}

/**
 * `GET /v1/auth/desktop-callback?state=…` — the social flow's browser landing.
 * Requires a live session cookie (Better Auth just set it) AND a well-formed
 * desktop-minted state; mints the single-use code and hands the browser the
 * `inteligir://session` deep link. No session / no state = failure copy, no
 * code minted.
 *
 * `ctx` is here only to `waitUntil` the expired-code sweep — see below.
 */
export async function handleDesktopCallback(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  if (state === null || !OPAQUE_PARAM.test(state)) {
    return interstitial(
      null,
      "This sign-in wasn't started from the inteligir app — open the app and try again.",
    );
  }

  const auth = createAuth(env, url.origin);
  const session = await auth.api.getSession({ headers: request.headers });
  if (session === null) {
    return interstitial(null, "Sign-in didn't complete. Return to inteligir and try again.");
  }

  const codeBytes = new Uint8Array(CODE_BYTES);
  crypto.getRandomValues(codeBytes);
  const code = base64Url(codeBytes);
  const now = new Date();
  const db = createDb(env.DB);
  // Opportunistic GC — expired codes are dead weight either way (the exchange
  // re-checks expiry), this just keeps the table from accumulating rows. It is
  // not needed for correctness, so it runs AFTER the response instead of adding
  // a D1 round-trip to the user's sign-in latency. Racing the insert below is
  // harmless: the predicate is `expiresAt < now` and the row we insert expires
  // 90s from now, so the sweep can never take it.
  ctx.waitUntil(db.delete(desktopAuthCode).where(lt(desktopAuthCode.expiresAt, now)).execute());
  await db.insert(desktopAuthCode).values({
    codeHash: await hashCode(code),
    token: session.session.token,
    email: session.user.email,
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
  });

  return interstitial(
    `inteligir://session?code=${code}&state=${state}`,
    "Signed in — returning you to inteligir…",
  );
}

/** Expected-failure VALUE (same convention as the DO's version conflicts):
 * bad/expired/replayed codes are a 200 `{ok:false}`, not a throw — the desktop
 * surfaces `error` verbatim. Only rate limiting is a transport-level status. */
type ExchangeResult = { ok: true; token: string; email: string } | { ok: false; error: string };

const EXCHANGE_FAILED: ExchangeResult = {
  ok: false,
  error: "This sign-in link is invalid or expired — try again from Settings.",
};

/**
 * `POST /v1/auth/exchange` — body `{code}`. Validates the opaque-token grammar,
 * burns the code atomically (DELETE … RETURNING settles a double-spend race on
 * exactly one winner), checks TTL, and returns the session bearer + email.
 */
export async function handleSessionExchange(request: Request, env: Env): Promise<Response> {
  const db = createDb(env.DB);
  if (env.RATE_LIMIT_DISABLED !== "true") {
    const key = `${EXCHANGE_RATE_KEY_PREFIX}${callerIp(request)}`;
    if (!(await allowInWindow(db, key, Date.now(), EXCHANGE_WINDOW))) {
      return new Response("rate limited", { status: 429 });
    }
  }

  let code: string;
  try {
    const body: unknown = await request.json();
    const candidate = isRecord(body) ? body.code : null;
    if (typeof candidate !== "string" || !OPAQUE_PARAM.test(candidate)) {
      return Response.json(EXCHANGE_FAILED);
    }
    code = candidate;
  } catch {
    return Response.json(EXCHANGE_FAILED);
  }

  const burned = await db
    .delete(desktopAuthCode)
    .where(eq(desktopAuthCode.codeHash, await hashCode(code)))
    .returning()
    .get();
  if (burned === undefined || burned.expiresAt.getTime() < Date.now()) {
    return Response.json(EXCHANGE_FAILED);
  }
  const result: ExchangeResult = { ok: true, token: burned.token, email: burned.email };
  return Response.json(result);
}
