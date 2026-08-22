// `GET /connectors/oauth/callback` — where the browser lands after a provider's
// consent page. Outside the contract table and the browser-origin guard for
// pair-callback's own reasons (src/node/cloud/pair-callback.ts): what arrives
// is a cross-site top-level navigation wanting a page, no typed client has any
// use for the row, and the armed `state` stands where the origin guard cannot.
// The page is inert by construction: no script, no external asset, a policy
// that says so.

import type { ConnectorOauthFlow, OauthCompletion } from "./oauth-flow";

interface CallbackPage {
  status: 200 | 400;
  title: string;
  detail: string;
}

function oauthCallbackPage(completion: OauthCompletion): CallbackPage {
  switch (completion.kind) {
    case "connected":
      return {
        status: 200,
        title: "Connected",
        detail: `Agent sessions now get "${completion.name}". You can close this tab.`,
      };
    case "no-pending":
      return {
        status: 400,
        title: "Nothing to authorize",
        detail:
          "This app is not waiting on a connector authorization. Nothing was changed. Start one from Settings → Connectors.",
      };
    case "state-mismatch":
      return {
        status: 400,
        title: "That approval was for something else",
        detail:
          "This link does not match the authorization this app started, so nothing was changed. Start one from Settings → Connectors and use the page it opens.",
      };
    case "expired":
      return {
        status: 400,
        title: "That took too long",
        detail:
          "The authorization this app started has expired, so nothing was changed. Start another from Settings → Connectors.",
      };
    case "refused":
      return { status: 400, title: "The provider refused", detail: completion.detail };
  }
}

const HTML_ESCAPES = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
  ["'", "&#39;"],
]);

function escapeHtml(value: string): string {
  return value.replaceAll(/[&<>"']/gu, (character) => HTML_ESCAPES.get(character) ?? character);
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
 * Missing or malformed parameters take the same road as a wrong state — this
 * URL is reachable by anything on the machine, so "called wrong" and "called
 * without an authorization" are the same non-event.
 */
export async function handleConnectorOauthCallback(
  flow: ConnectorOauthFlow,
  url: URL,
): Promise<{ status: 200 | 400; body: string; headers: Record<string, string> }> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const completion: OauthCompletion =
    code === null || state === null ? { kind: "no-pending" } : await flow.complete({ code, state });
  const page = oauthCallbackPage(completion);
  return {
    status: page.status,
    body: renderPage(page),
    headers: {
      "content-type": "text/html; charset=utf-8",
      // The URL that reached here carries an authorization code.
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  };
}
