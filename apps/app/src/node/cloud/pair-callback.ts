// `GET /pair/callback` — where the browser lands after someone approves this
// device on their account (issue #573).
//
// WHY IT IS NOT A ROW IN THE CONTRACT TABLE, stated the way `/ws` states its
// own: what arrives here is a BROWSER following a top-level redirect, and what
// it must receive is a page a person can read. The table's rows are JSON with a
// typed client derived from them, and there is no client here to derive —
// nothing in this repo calls this route; a browser does. Putting it in the
// table would offer `client.cloud.pairCallback.$get()` to code that has no use
// for it and would make the answer JSON for the one caller that cannot read
// any.
//
// IT IS ALSO OUTSIDE THE BROWSER-ORIGIN GUARD, and that is the same fact from
// the other side: this request IS a cross-site top-level navigation from the
// account's own web origin, which is precisely what that guard exists to
// refuse. What stands in its place is the `state` — 128 bits this app minted
// and is still waiting on — so a callback nobody here initiated does nothing
// and says so. Any local page can navigate a browser at a loopback URL; none
// of them can guess the state.
//
// The page it answers is inert by construction: no script, no external asset,
// and a policy that says so.

import {
  PAIR_CALLBACK_HOST,
  PAIR_CALLBACK_PARAMS,
  PAIR_CALLBACK_PATH,
  pairRedirectUrlSchema,
} from "@repo/cloud-contract/pairing";
import { describeCloudFailure } from "./cloud-client";
import type { CloudRuntime, PairCompletion } from "./sync-runtime";
import { loopbackRequestOrigin } from "../browser-request-guard";

/**
 * The callback URL for a request that reached this app on its own loopback
 * origin, or null when it did not.
 *
 * THE PORT COMES FROM THE REQUEST, not from the resolved config: `listen` may
 * probe past a busy dev port, so the configured number is a guess and the
 * caller's own Host header is the fact. The HOST does not: it is normalised to
 * the `127.0.0.1` literal even when the caller reached `localhost`, because the
 * literal is what this process binds and what the contract admits — and the
 * page this redirect lands on is standalone HTML, so it loses nothing by
 * arriving on the other spelling of the same address.
 *
 * The composed URL is then judged by the CONTRACT's own schema, so the app's
 * own composition passes through the same allowlist the approve page does.
 * There is exactly one gate, and this is it.
 */
export function pairCallbackUrlFor(host: string | undefined): string | null {
  const origin = loopbackRequestOrigin(host);
  if (origin === null) {
    return null;
  }
  const url = new URL(origin);
  url.hostname = PAIR_CALLBACK_HOST;
  const candidate = `${url.origin}${PAIR_CALLBACK_PATH}`;
  return pairRedirectUrlSchema.safeParse(candidate).success ? candidate : null;
}

interface CallbackPage {
  status: 200 | 400;
  title: string;
  detail: string;
}

/** What the browser is told, per outcome — every refusal its own sentence,
 *  because "nothing was waiting for this" and "that took too long" are
 *  different things to have done wrong. */
function pairCallbackPage(completion: PairCompletion): CallbackPage {
  switch (completion.kind) {
    case "paired":
      return {
        status: 200,
        title: "Paired",
        detail: "This device is now syncing with your account. You can close this tab.",
      };
    case "no-pending":
      return {
        status: 400,
        title: "Nothing to approve",
        detail:
          "This app is not waiting on a pairing. Nothing was changed. Start one from Settings → Devices, or run `inteligir sync pair`.",
      };
    case "state-mismatch":
      return {
        status: 400,
        title: "That approval was for something else",
        detail:
          "This link does not match the pairing this app started, so nothing was changed. Start one from Settings → Devices and use the page it opens.",
      };
    case "expired":
      return {
        status: 400,
        title: "That took too long",
        detail:
          "The pairing this app started has expired, so nothing was changed. Start another from Settings → Devices.",
      };
    case "refused":
      return {
        status: 400,
        title: "Your account refused the pairing",
        detail: describeCloudFailure(completion.failure),
      };
  }
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Everything interpolated below is this process's own text today, and the
 *  cloud's refusal sentence is the one piece that is not — escaped anyway,
 *  because "the source is trusted" is the assumption that stops being true
 *  without anyone editing this file. */
function escapeHtml(value: string): string {
  return value.replaceAll(/[&<>"']/gu, (character) => HTML_ESCAPES[character] ?? character);
}

function renderPage(page: CallbackPage): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.title)} — inteligir</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; display: grid; place-items: center; min-height: 100vh;
         font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 28rem; padding: 2rem; }
  h1 { font-size: 1.125rem; font-weight: 600; margin: 0 0 0.5rem; }
  p { margin: 0; opacity: 0.75; }
</style>
</head>
<body><main><h1>${escapeHtml(page.title)}</h1><p>${escapeHtml(page.detail)}</p></main></body>
</html>
`;
}

/**
 * The whole browser-facing half: consume the state, redeem, answer a page.
 *
 * Missing or malformed parameters take the same road as a wrong state — this
 * URL is reachable by anything on the machine, so "you called it wrong" and
 * "you called it without an approval" are the same non-event.
 */
export async function handlePairCallback(
  runtime: CloudRuntime,
  url: URL,
): Promise<{ status: 200 | 400; body: string; headers: Record<string, string> }> {
  const code = url.searchParams.get(PAIR_CALLBACK_PARAMS.code);
  const state = url.searchParams.get(PAIR_CALLBACK_PARAMS.state);
  const completion: PairCompletion =
    code === null || state === null
      ? { kind: "no-pending" }
      : await runtime.completePair({ code, state });
  const page = pairCallbackPage(completion);
  return {
    status: page.status,
    body: renderPage(page),
    headers: {
      "content-type": "text/html; charset=utf-8",
      // The URL that reached here carries a pairing code, and this page links
      // nowhere — but a policy is cheaper than reasoning about who might add a
      // link later.
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  };
}
