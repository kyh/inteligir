// An assistant let into a test account's library as Claude or ChatGPT is let in: it registers
// itself, sends the signed-in person to the consent page with a PKCE challenge, trades the code
// the page hands back for a token, and calls the connector with a real MCP client. Every request
// goes to the Worker in process (`exports.default.fetch`).

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { CONNECTOR_PATH } from "@repo/contract/cloud/connector";
import { exports } from "cloudflare:workers";
import { expect } from "vitest";
import { z } from "zod";

import { cookieHeaderOf, ORIGIN } from "./cloud-helpers";

export const CONNECTOR_URL = `${ORIGIN}${CONNECTOR_PATH}`;

// where a desktop client listens for its code; nothing listens here, since the test reads the
// redirect itself
export const REDIRECT_URI = "http://127.0.0.1:43123/callback";

// what every client's request carries, which the connector's Host check reads, unless the test
// names another
export const workerFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input, init);
  const headers = new Headers(request.headers);
  if (!headers.has("host")) {
    headers.set("host", new URL(request.url).host);
  }
  return await exports.default.fetch(new Request(request, { headers }));
};

const base64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCodePoint(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");

export const pkcePair = async (): Promise<{ verifier: string; challenge: string }> => {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { challenge: base64Url(new Uint8Array(digest)), verifier };
};

const registeredSchema = z.object({ client_id: z.string().min(1) });

// a client that registers itself (RFC 7591), as one that publishes no metadata document does
export const registerClient = async (clientName = "Claude"): Promise<string> => {
  const response = await workerFetch(`${ORIGIN}/oauth/register`, {
    body: JSON.stringify({
      client_name: clientName,
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: [REDIRECT_URI],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(response.status).toBe(201);
  return registeredSchema.parse(await response.json()).client_id;
};

export const authorizeUrl = (
  clientId: string,
  challenge: string,
  state = crypto.randomUUID(),
): string => {
  const url = new URL("/connect/authorize", ORIGIN);
  for (const [name, value] of Object.entries({
    client_id: clientId,
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: REDIRECT_URI,
    resource: CONNECTOR_URL,
    response_type: "code",
    scope: "library:read",
    state,
  })) {
    url.searchParams.set(name, value);
  }
  return url.toString();
};

export interface ConsentShown {
  readonly html: string;
  readonly handle: string;
  // the person's session and the cookie binding the form to this browser
  readonly cookie: string;
  readonly response: Response;
}

// the page a signed-in person sees, and what its form posts back
export const showConsent = async (cookie: string, url: string): Promise<ConsentShown> => {
  const response = await workerFetch(url, { headers: { cookie } });
  const html = await response.text();
  expect(response.status, html).toBe(200);
  const handle = /name="handle" value="(?<handle>[^"]+)"/u.exec(html)?.groups?.["handle"];
  if (handle === undefined) {
    throw new Error("the consent page carries no form handle");
  }
  return { cookie: `${cookie}; ${cookieHeaderOf(response)}`, handle, html, response };
};

// the person's answer, and where the page sends the browser after it
export const answerConsent = async (
  url: string,
  shown: ConsentShown,
  answer: { readonly decision: "allow" | "deny"; readonly readOnly?: boolean },
): Promise<URL> => {
  const form = new URLSearchParams({ decision: answer.decision, handle: shown.handle });
  if (answer.readOnly === true) {
    form.set("access", "read");
  }
  const response = await workerFetch(url, {
    body: form,
    headers: { cookie: shown.cookie },
    method: "POST",
    redirect: "manual",
  });
  await response.arrayBuffer();
  expect(response.status).toBe(302);
  return new URL(response.headers.get("location") ?? "");
};

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  resource: z.string(),
  scope: z.string(),
  token_type: z.string(),
});

export type MintedToken = z.infer<typeof tokenSchema>;

export const exchangeCode = async (
  clientId: string,
  code: string,
  verifier: string,
): Promise<MintedToken> => {
  const response = await workerFetch(`${ORIGIN}/oauth/token`, {
    body: new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
      resource: CONNECTOR_URL,
    }),
    method: "POST",
  });
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  return tokenSchema.parse(body);
};

// the whole of it: an assistant let in by the person signed in under `cookie`, and its token
export const connectAssistant = async (
  cookie: string,
  options: { readonly clientName?: string; readonly readOnly?: boolean } = {},
): Promise<MintedToken & { readonly clientId: string }> => {
  const clientId = await registerClient(options.clientName);
  const { challenge, verifier } = await pkcePair();
  const url = authorizeUrl(clientId, challenge);
  const shown = await showConsent(cookie, url);
  const redirect = await answerConsent(url, shown, {
    decision: "allow",
    readOnly: options.readOnly ?? false,
  });
  const code = redirect.searchParams.get("code");
  if (code === null) {
    throw new Error(`the consent page answered ${redirect.toString()}`);
  }
  return { ...(await exchangeCode(clientId, code, verifier)), clientId };
};

// an MCP client on the connector, with the token in hand
export const connectorClient = async (
  token: string,
  era: "legacy" | "modern" = "legacy",
): Promise<Client> => {
  const client = new Client(
    { name: "test-assistant", version: "1.0.0" },
    era === "modern" ? { versionNegotiation: { mode: "auto" } } : {},
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(CONNECTOR_URL), {
      authProvider: { token: async () => await Promise.resolve(token) },
      fetch: workerFetch,
    }),
  );
  return client;
};
