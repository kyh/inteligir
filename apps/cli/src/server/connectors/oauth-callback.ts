// outside the contract table and the browser-origin guard: what arrives is a cross-site
// top-level navigation, and the armed `state` stands where the origin guard cannot.

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

// missing params take the wrong-state road: this url is reachable by anything on the machine.
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
