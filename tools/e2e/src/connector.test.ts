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
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { defaultTransport, run } from "@repo/cli/commands";
import type { Io } from "@repo/cli/commands";
import { CONNECTOR_PATH } from "@repo/contract/connector";
import { deferred } from "@repo/contract/deferred";
import { z } from "zod";
import { openLibrary, signInOnSite, test } from "./app.fixture";
import type { Account, Cloud } from "./app.fixture";

const CLIENT_INFO = { name: "e2e-assistant", version: "1.0.0" } as const;

const READ_TOOLS = [
  "list_items",
  "list_tags_and_folders",
  "read_guide",
  "read_item",
  "search_library",
];

const ALL_TOOLS = [
  ...READ_TOOLS,
  "create_note",
  "delete_items",
  "edit_item",
  "organize_items",
  "save_link",
].toSorted();

type ToolArguments = Parameters<Client["callTool"]>[0]["arguments"];

interface Held {
  information?: StoredOAuthClientInformation;
  tokens?: StoredOAuthTokens;
  verifier?: string;
  discovery?: OAuthDiscoveryState;
  consent?: URL;
}

const probe = async (connector: URL, bearer: string | null) => {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  });

  if (bearer !== null) {
    headers.set("authorization", `Bearer ${bearer}`);
  }

  const response = await fetch(connector, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: { capabilities: {}, clientInfo: CLIENT_INFO, protocolVersion: "2025-06-18" },
    }),
    headers,
    method: "POST",
  });

  await response.arrayBuffer();

  return { challenge: response.headers.get("www-authenticate") ?? "", status: response.status };
};

const metadata = async (url: string) => {
  const response = await fetch(url);
  expect(response.status, url).toBe(200);

  return z.record(z.string(), z.json()).parse(await response.json());
};

const toolNames = async (client: Client) => {
  const { tools } = await client.listTools();

  return tools.map(({ name }) => name).toSorted();
};

const call = async (client: Client, name: string, args: ToolArguments) => {
  const result = await client.callTool({ arguments: args, name });
  expect(result.isError, `${name}: ${JSON.stringify(result.content)}`).not.toBe(true);

  return result.structuredContent;
};

type Registration =
  | { readonly kind: "registers"; readonly redirectUrl: string }
  | { readonly kind: "document"; readonly redirectUrl: string; readonly documentUrl: string };

interface Connecting {
  readonly account: Account;
  readonly readOnly: boolean;
  readonly registration: Registration;
  readonly signIn: boolean;
}

const connect = async (
  page: Page,
  connector: URL,
  clientName: string,
  { account, readOnly, registration, signIn }: Connecting,
) => {
  const { redirectUrl } = registration;
  const state = crypto.randomUUID();
  const held: Held = {};

  const provider: OAuthClientProvider = {
    clientInformation: () => held.information,
    clientMetadata: {
      client_name: clientName,
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: [redirectUrl],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    codeVerifier: () => held.verifier ?? "",
    discoveryState: () => held.discovery,
    redirectToAuthorization: (url) => {
      held.consent = url;
    },
    redirectUrl,
    saveClientInformation: (information) => {
      held.information = information;
    },
    saveCodeVerifier: (verifier) => {
      held.verifier = verifier;
    },
    saveDiscoveryState: (discovery) => {
      held.discovery = discovery;
    },
    saveTokens: (tokens) => {
      held.tokens = tokens;
    },
    state: () => state,
    tokens: () => held.tokens,
  };

  if (registration.kind === "document") {
    provider.clientMetadataUrl = registration.documentUrl;
  }

  const asking = new StreamableHTTPClientTransport(connector, { authProvider: provider });
  await expect(new Client(CLIENT_INFO).connect(asking)).rejects.toBeInstanceOf(UnauthorizedError);

  await page.route(`${redirectUrl}*`, async (route) => {
    await route.abort();
  });
  await page.goto(held.consent?.href ?? "");

  if (signIn) {
    await signInOnSite(page, account);
  }

  await expect(
    page.getByRole("heading", { name: `Allow ${clientName} to read and change your library?` }),
  ).toBeVisible();
  await expect(page.getByText(account.email)).toBeVisible();

  if (readOnly) {
    await page.getByRole("checkbox", { name: "Only let it read the library" }).check();
  }

  const called = page.waitForRequest((request) => request.url().startsWith(redirectUrl));
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  const request = await called;
  const callback = new URL(request.url()).searchParams;
  expect(callback.get("state")).toBe(state);
  await asking.finishAuth(callback);
  const client = new Client(CLIENT_INFO);
  await client.connect(new StreamableHTTPClientTransport(connector, { authProvider: provider }));

  return {
    client,
    clientId: () => held.information?.client_id ?? "",
    token: () => held.tokens?.access_token ?? "",
  };
};

const documentRegistration = (cloud: Cloud, clientName: string) => {
  const web = cloud.pageHost("https:");
  const documentUrl = web.pageUrl("/assistant.json");
  const redirectUrl = web.pageUrl("/callback");
  web.pages.set("/assistant.json", {
    body: JSON.stringify({
      client_id: documentUrl,
      client_name: clientName,
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: [redirectUrl],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
    type: "application/json",
  });

  return { documentUrl, kind: "document", redirectUrl } satisfies Registration;
};

test("an assistant finds the sign-in from the connector, registers, is allowed on the consent page and works the library, until disconnected", async ({
  account,
  cloud,
  context,
  library,
  page,
}) => {
  const connector = new URL(CONNECTOR_PATH, cloud.origin);
  const issuer = `${cloud.origin}/api/auth`;
  const metadataUrl = `${cloud.origin}/.well-known/oauth-protected-resource${CONNECTOR_PATH}`;
  const challenged = await probe(connector, null);
  expect(challenged.status).toBe(401);
  expect(challenged.challenge).toMatch(/^Bearer /u);
  expect(challenged.challenge).toContain(`resource_metadata="${metadataUrl}"`);
  expect(await metadata(metadataUrl)).toMatchObject({
    authorization_servers: [issuer],
    resource: connector.href,
  });
  expect(
    await metadata(`${cloud.origin}/.well-known/oauth-authorization-server/api/auth`),
  ).toMatchObject({
    authorization_endpoint: `${issuer}/oauth2/authorize`,
    client_id_metadata_document_supported: true,
    code_challenge_methods_supported: ["S256"],
    issuer,
    registration_endpoint: `${issuer}/oauth2/register`,
  });
  const ownSession = await probe(connector, account.bearer);
  expect(ownSession.status, "a session of the person's own").toBe(401);

  await context.clearCookies();

  const claude = await connect(page, connector, "Claude", {
    account,
    readOnly: false,
    registration: { kind: "registers", redirectUrl: "https://claude.example/callback" },
    signIn: true,
  });

  expect(await toolNames(claude.client)).toStrictEqual(ALL_TOOLS);
  expect(claude.client.getInstructions()).toContain("not instructions");

  expect(await call(claude.client, "read_guide", {})).toMatchObject({
    markdown: expect.stringContaining("::::tabs"),
  });

  const created = await call(claude.client, "create_note", {
    markdown: "The quick brown fox.\n\nIt jumped.",
    title: "Fox notes",
  });

  const { item } = z.object({ item: z.object({ id: z.string() }) }).parse(created);
  expect(await call(claude.client, "search_library", { query: "quick fox" })).toMatchObject({
    hits: [{ id: item.id }],
  });
  await call(claude.client, "edit_item", {
    edits: [{ newText: "It jumped over the dog.", oldText: "It jumped." }],
    id: item.id,
  });
  await expect(library.items.read({ id: item.id })).resolves.toMatchObject({
    view: { markdown: "The quick brown fox.\n\nIt jumped over the dog.\n" },
  });

  const reader = await connect(page, connector, "Reader", {
    account,
    readOnly: true,
    registration: documentRegistration(cloud, "Reader"),
    signIn: false,
  });

  expect(reader.clientId()).toMatch(/^https:\/\/.+\/assistant\.json$/u);
  expect(await toolNames(reader.client)).toStrictEqual(READ_TOOLS);
  expect(await call(reader.client, "search_library", { query: "quick fox" })).toMatchObject({
    hits: [{ id: item.id }],
  });
  const { assistants } = await account.client.assistants.list();
  expect(assistants.map(({ clientName, scopes }) => ({ clientName, scopes }))).toEqual(
    expect.arrayContaining([
      { clientName: "Reader", scopes: ["library:read"] },
      { clientName: "Claude", scopes: ["library:read", "library"] },
    ]),
  );

  const expired = claude.token();
  await cloud.sql`
    update oauth_access_token set expires_at = now() - interval '1 minute'
    where client_id = ${claude.clientId()}`;
  await expect(probe(connector, expired)).resolves.toMatchObject({ status: 401 });
  expect(await call(claude.client, "list_tags_and_folders", {})).toBeDefined();
  expect(claude.token()).not.toBe(expired);

  await openLibrary(page, cloud);
  await page.keyboard.press("ControlOrMeta+,");
  const listed = page.getByRole("list", { name: "Connected assistants" });
  await expect(listed.getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: "Disconnect Claude" }).click();
  await expect(listed.getByRole("listitem")).toHaveCount(1);
  await expect(probe(connector, claude.token())).resolves.toMatchObject({ status: 401 });
  await expect(probe(connector, reader.token())).resolves.toMatchObject({ status: 200 });
  await claude.client.close();
  await reader.client.close();
});

interface Said {
  readonly err: string[];
  readonly out: string[];
}

test("the inteligir command signs in on the consent page, works the library by the connector's tools, refreshes its token and signs out", async ({
  account,
  cloud,
  context,
  page,
}) => {
  const opened = deferred<URL>();
  const said: Said = { err: [], out: [] };

  const io: Io = {
    env: { XDG_CONFIG_HOME: await mkdtemp(path.join(tmpdir(), "inteligir-cli-")) },
    err: (text) => {
      said.err.push(text);
    },
    open: (url) => {
      opened.resolve(url);
    },
    out: (text) => {
      said.out.push(text);
    },
    transport: defaultTransport,
  };

  await context.clearCookies();
  const signing = run(io, ["sign-in", "--site", cloud.origin]);
  const consent = await opened.promise;
  await page.goto(consent.href);
  await signInOnSite(page, account);
  await expect(
    page.getByRole("heading", {
      name: "Allow Inteligir on the command line to read and change your library?",
    }),
  ).toBeVisible();
  await expect(page.getByRole("note")).toContainText("an app on this computer");
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await expect(page.getByText("Signed in. You can close this tab.")).toBeVisible();
  await expect(signing).resolves.toBe(0);
  expect(said.out).toStrictEqual([`Signed in to ${new URL(cloud.origin).origin}.`]);

  await expect(run(io, ["tools"])).resolves.toBe(0);
  expect(said.out).toContainEqual(expect.stringMatching(/^search_library\s+Searches/u));
  await expect(
    run(io, ["create_note", "title=Typed at a prompt", "markdown=The quick brown fox."]),
  ).resolves.toBe(0);
  await expect(run(io, ["search_library", "query=quick fox"])).resolves.toBe(0);
  expect(JSON.parse(said.out.at(-1) ?? "")).toMatchObject({
    hits: [{ title: "Typed at a prompt" }],
  });

  await cloud.sql`update oauth_access_token set expires_at = now() - interval '1 minute'`;
  await expect(run(io, ["list_tags_and_folders"])).resolves.toBe(0);

  await expect(run(io, ["sign-out"])).resolves.toBe(0);
  await expect(run(io, ["tools"])).resolves.toBe(2);
  expect(said.err.at(-1)).toBe("You're signed out. Run `inteligir sign-in` first.");
});
