// An assistant reaching a library through the connector as Claude or ChatGPT does: the MCP SDK's
// own OAuth client reads the connector's challenge, finds the authorization server, registers
// itself and hands over the consent page's address for the person's browser; the page sends the
// code back to a loopback listener, as it does a desktop client's (RFC 8252 §7.3), and the SDK
// trades it for a token. Every credential is held in memory, one assistant at a time.

import { once } from "node:events";
import { createServer } from "node:http";
import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import { z } from "zod";
import { expect } from "./assert";
import { pollUntil } from "./poll";

const CALLBACK_PATH = "/callback";

// a listener on a port of its own holds an address, never a pipe's path
const addressSchema = z.object({ port: z.number().int().positive() });

const CLIENT_INFO = { name: "e2e-assistant", version: "1.0.0" } as const;

export interface ConnectorAssistant {
  // the name it registers under, which the consent page asks about
  readonly clientName: string;
  // connects with no token, is refused, and answers the consent page's address for the browser
  askForAccess: () => Promise<URL>;
  // waits for the page to send the code back, trades it for a token and connects with it
  finishConnecting: (deadlineMs: number) => Promise<Client>;
  // the access token it holds, which a scenario presents on its own to show it refused
  accessToken: () => string;
  close: () => Promise<void>;
}

interface CodeListener {
  readonly redirectUrl: string;
  // the callback's query, once the browser reached it
  readonly received: () => URLSearchParams | null;
  readonly close: () => Promise<void>;
}

const listenForCode = async (): Promise<CodeListener> => {
  let received: URLSearchParams | null = null;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== CALLBACK_PATH) {
      response.writeHead(404).end();
      return;
    }
    received = url.searchParams;
    response
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end("<!doctype html><title>Connected</title><p>Connected. You can close this window.</p>");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = addressSchema.parse(server.address());
  return {
    close: async () => {
      const closed = once(server, "close");
      server.close();
      await closed;
    },
    received: () => received,
    redirectUrl: `http://127.0.0.1:${String(port)}${CALLBACK_PATH}`,
  };
};

export const startAssistant = async (
  connectorUrl: URL,
  clientName: string,
): Promise<ConnectorAssistant> => {
  const listener = await listenForCode();
  const state = crypto.randomUUID();
  let information: StoredOAuthClientInformation | undefined;
  let tokens: StoredOAuthTokens | undefined;
  let verifier: string | undefined;
  let discovery: OAuthDiscoveryState | undefined;
  let consentAt: URL | undefined;

  const provider: OAuthClientProvider = {
    clientInformation: () => information,
    clientMetadata: {
      client_name: clientName,
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: [listener.redirectUrl],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    codeVerifier: () => {
      if (verifier === undefined) {
        throw new Error("the code is traded before a verifier was made");
      }
      return verifier;
    },
    discoveryState: () => discovery,
    redirectToAuthorization: (url) => {
      consentAt = url;
    },
    redirectUrl: listener.redirectUrl,
    saveClientInformation: (held) => {
      information = held;
    },
    saveCodeVerifier: (held) => {
      verifier = held;
    },
    saveDiscoveryState: (held) => {
      discovery = held;
    },
    saveTokens: (held) => {
      tokens = held;
    },
    state: () => state,
    tokens: () => tokens,
  };

  // the one that met the challenge, which keeps what it learned for the code's exchange
  const asking = new StreamableHTTPClientTransport(connectorUrl, { authProvider: provider });

  return {
    accessToken: () => {
      if (tokens === undefined) {
        throw new Error(`${clientName} holds no token yet`);
      }
      return tokens.access_token;
    },
    askForAccess: async () => {
      const client = new Client(CLIENT_INFO);
      let refused = false;
      try {
        await client.connect(asking);
      } catch (error) {
        if (!(error instanceof UnauthorizedError)) {
          throw error;
        }
        refused = true;
      }
      expect(refused, `${clientName} connected before it was let in`);
      if (consentAt === undefined) {
        throw new Error(`${clientName} was refused, and sent nobody to the consent page`);
      }
      return consentAt;
    },
    clientName,
    close: async () => {
      await listener.close();
    },
    finishConnecting: async (deadlineMs) => {
      const callback = await pollUntil(
        async () => await Promise.resolve(listener.received()),
        (params): params is URLSearchParams => params !== null,
        {
          deadlineMs,
          describe: () => `the consent page never sent ${clientName} its code`,
          intervalMs: 200,
        },
      );
      expect(
        callback.get("state") === state,
        `${clientName}'s callback carried another state: ${callback.toString()}`,
      );
      expect(
        callback.has("code"),
        `${clientName}'s callback carried no code: ${callback.toString()}`,
      );
      await asking.finishAuth(callback);
      const client = new Client(CLIENT_INFO);
      await client.connect(
        new StreamableHTTPClientTransport(connectorUrl, { authProvider: provider }),
      );
      return client;
    },
  };
};
