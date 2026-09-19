// outside the contract table and the browser-origin guard: what arrives is a cross-site
// top-level navigation, and the armed `state` stands where the origin guard cannot.

import type { ConnectorOauthFlow, OauthCompletion } from "./oauth-flow";
import { INERT_CALLBACK_HEADERS, renderInertCallbackPage } from "../inert-callback-page";
import type { InertCallbackPage } from "../inert-callback-page";

const oauthCallbackPage = (completion: OauthCompletion): InertCallbackPage => {
  switch (completion.kind) {
    case "connected": {
      return {
        detail: `Agent sessions now get "${completion.name}". You can close this tab.`,
        status: 200,
        title: "Connected",
      };
    }
    case "no-pending": {
      return {
        detail:
          "This app is not waiting on a connector authorization. Nothing was changed. Start one from Settings → Connectors.",
        status: 400,
        title: "Nothing to authorize",
      };
    }
    case "state-mismatch": {
      return {
        detail:
          "This link does not match the authorization this app started, so nothing was changed. Start one from Settings → Connectors and use the page it opens.",
        status: 400,
        title: "That approval was for something else",
      };
    }
    case "expired": {
      return {
        detail:
          "The authorization this app started has expired, so nothing was changed. Start another from Settings → Connectors.",
        status: 400,
        title: "That took too long",
      };
    }
    case "refused": {
      return { detail: completion.detail, status: 400, title: "The provider refused" };
    }
    // no default
  }
};

// missing params take the wrong-state road: this url is reachable by anything on the machine.
export const handleConnectorOauthCallback = async (
  flow: ConnectorOauthFlow,
  url: URL,
): Promise<{ status: 200 | 400; body: string; headers: Record<string, string> }> => {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const completion: OauthCompletion =
    code === null || state === null ? { kind: "no-pending" } : await flow.complete({ code, state });
  const page = oauthCallbackPage(completion);
  return {
    body: renderInertCallbackPage(page),
    headers: INERT_CALLBACK_HEADERS,
    status: page.status,
  };
};
