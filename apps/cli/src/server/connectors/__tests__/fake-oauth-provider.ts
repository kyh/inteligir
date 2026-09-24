// one loopback server playing an MCP server and its authorization server: the 401 challenge, the
// protected resource and authorization server metadata, registration, a consent page that
// approves at once, and the token endpoint.

import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { onTestFinished } from "vitest";

import type { ConnectorOauthFlow } from "../oauth-flow";
import { boundAddressSchema } from "../../__tests__/bound-address";

export const REDIRECT_URI = "http://127.0.0.1:4664/connectors/oauth/callback";

export const beginUrl = async (
  flow: ConnectorOauthFlow,
  redirectUri = REDIRECT_URI,
): Promise<URL> => {
  const begun = await flow.begin("linear", redirectUri);
  if (!begun.ok) {
    throw new Error(`begin refused: ${begun.detail}`);
  }
  return new URL(begun.url);
};

export interface ProviderAnswer {
  status: number;
  body: unknown;
}

type ProviderResponder = ProviderAnswer | ((request: URLSearchParams) => ProviderAnswer);

export interface FakeProvider {
  origin: string;
  mcpUrl: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  // token requests alone, in arrival order
  requests: URLSearchParams[];
  // every registration body, in arrival order
  registrations: unknown[];
  // `${method} ${path}` of every request
  hits: string[];
  // GET <path> answers the document; a path not here is a 404
  documents: Map<string, unknown>;
  // the MCP endpoint's 401 carries this as its WWW-Authenticate, or no header when null
  challenge: string | null;
  registrationAnswer: ProviderAnswer | null;
  respondWith: ProviderResponder;
}

export const s256 = (verifier: string): string =>
  createHash("sha256").update(verifier, "ascii").digest("base64url");

const readBody = async (request: IncomingMessage): Promise<string> => {
  let raw = "";
  for await (const chunk of request) {
    raw += String(chunk);
  }
  return raw;
};

const answer = (response: ServerResponse, reply: ProviderAnswer): void => {
  response.writeHead(reply.status, { "content-type": "application/json" });
  response.end(JSON.stringify(reply.body));
};

export const startFakeProvider = async (): Promise<FakeProvider> => {
  // a code the consent page minted, with the challenge and client it was minted for.
  const minted = new Map<string, { challenge: string; clientId: string }>();
  let codes = 0;
  let registered = 0;

  const provider: FakeProvider = {
    authorizationEndpoint: "",
    challenge: null,
    documents: new Map(),
    hits: [],
    mcpUrl: "",
    origin: "",
    registrationAnswer: null,
    registrations: [],
    requests: [],
    respondWith: {
      body: { access_token: "at-1", expires_in: 3600, refresh_token: "rt-1" },
      status: 200,
    },
    tokenEndpoint: "",
  };

  // a code the consent page minted must come back with its verifier and client; any other code
  // is the suite's own, answered by `respondWith`.
  const tokenAnswer = (params: URLSearchParams): ProviderAnswer => {
    const code = params.get("code") ?? "";
    const grant = minted.get(code);
    minted.delete(code);
    const verifier = params.get("code_verifier") ?? "";
    if (
      grant !== undefined &&
      (s256(verifier) !== grant.challenge || params.get("client_id") !== grant.clientId)
    ) {
      return { body: { error: "invalid_grant" }, status: 400 };
    }
    return provider.respondWith instanceof Function
      ? provider.respondWith(params)
      : provider.respondWith;
  };

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", provider.origin);
      provider.hits.push(`${request.method ?? "GET"} ${url.pathname}`);
      const raw = await readBody(request);
      if (request.method === "POST" && url.pathname === "/oauth/token") {
        const params = new URLSearchParams(raw);
        provider.requests.push(params);
        answer(response, tokenAnswer(params));
        return;
      }
      if (request.method === "POST" && url.pathname === "/register") {
        const registration: unknown = JSON.parse(raw);
        provider.registrations.push(registration);
        registered += 1;
        answer(
          response,
          provider.registrationAnswer ?? {
            body: { client_id: `dcr-${String(registered)}`, token_endpoint_auth_method: "none" },
            status: 201,
          },
        );
        return;
      }
      if (url.pathname === "/mcp") {
        const headers: Record<string, string> =
          provider.challenge === null ? {} : { "www-authenticate": provider.challenge };
        response.writeHead(401, headers);
        response.end();
        return;
      }
      if (url.pathname === "/oauth/authorize") {
        codes += 1;
        const code = `minted-${String(codes)}`;
        minted.set(code, {
          challenge: url.searchParams.get("code_challenge") ?? "",
          clientId: url.searchParams.get("client_id") ?? "",
        });
        const back = new URL(url.searchParams.get("redirect_uri") ?? "");
        back.searchParams.set("code", code);
        back.searchParams.set("state", url.searchParams.get("state") ?? "");
        response.writeHead(302, { location: back.toString() });
        response.end();
        return;
      }
      const document = provider.documents.get(url.pathname);
      answer(
        response,
        document === undefined ? { body: {}, status: 404 } : { body: document, status: 200 },
      );
    })();
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = boundAddressSchema.parse(server.address());
  const origin = `http://127.0.0.1:${String(port)}`;
  provider.origin = origin;
  provider.mcpUrl = `${origin}/mcp`;
  provider.authorizationEndpoint = `${origin}/oauth/authorize`;
  provider.tokenEndpoint = `${origin}/oauth/token`;
  provider.challenge = `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="read write"`;
  provider.documents.set("/.well-known/oauth-protected-resource/mcp", {
    authorization_servers: [origin],
    resource: provider.mcpUrl,
    scopes_supported: ["read"],
  });
  provider.documents.set("/.well-known/oauth-authorization-server", {
    authorization_endpoint: provider.authorizationEndpoint,
    code_challenge_methods_supported: ["S256"],
    issuer: origin,
    registration_endpoint: `${origin}/register`,
    token_endpoint: provider.tokenEndpoint,
  });
  onTestFinished(async () => {
    const closed = once(server, "close");
    server.close();
    await closed;
  });
  return provider;
};
