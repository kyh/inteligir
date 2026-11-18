// What an assistant reads before it holds a credential: the connector's protected resource metadata
// (RFC 9728), which names the authorization server, and that server's metadata (RFC 8414) at the
// path-inserted form of the issuer `<origin>/api/auth`.

import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";

import { getAuth } from "./auth";
import { CONNECTOR_RESOURCE, CONNECTOR_SCOPES, OAUTH_ISSUER } from "./oauth-auth";

const DISCOVERY_HEADERS = {
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=3600",
};

// a browser assistant sends the protocol version header, which needs a preflight
export const discoveryPreflightResponse = () =>
  new Response(null, {
    headers: {
      "access-control-allow-headers": "mcp-protocol-version",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-origin": "*",
      "access-control-max-age": "3600",
    },
    status: 204,
  });

export const protectedResourceMetadataResponse = async () =>
  Response.json(
    await oauthProviderResourceClient(getAuth())
      .getActions()
      .getProtectedResourceMetadata({
        authorization_servers: [OAUTH_ISSUER],
        bearer_methods_supported: ["header"],
        resource: CONNECTOR_RESOURCE,
        resource_name: "Inteligir",
        scopes_supported: [...CONNECTOR_SCOPES],
      }),
    { headers: DISCOVERY_HEADERS },
  );

export const authorizationServerMetadataResponse = async (request: Request) =>
  await oauthProviderAuthServerMetadata(getAuth(), { headers: DISCOVERY_HEADERS })(request);
