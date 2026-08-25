// `GET /connectors/oauth/callback` — where the browser lands after a provider's
// consent page. Outside the contract table and the browser-origin guard for
// pair-callback's own reasons (cloud/pair-callback.ts): what arrives
// is a cross-site top-level navigation wanting a page, no typed client has any
// use for the row, and the armed `state` stands where the origin guard cannot.
// The page is inert by construction: no script, no external asset, a policy
// that says so.

import type { ConnectorOauthFlow, OauthCompletion } from "./oauth-flow";
import {
  INERT_CALLBACK_HEADERS,
  type InertCallbackPage,
  renderInertCallbackPage,
} from "../inert-callback-page";

function oauthCallbackPage(completion: OauthCompletion): InertCallbackPage {
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
    body: renderInertCallbackPage(page),
    headers: INERT_CALLBACK_HEADERS,
  };
}
