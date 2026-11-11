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
import { CONNECTOR_PATH } from "@repo/contract/connector";
import { z } from "zod";
import { openLibrary, signInOnSite, test } from "./fixtures";
import type { Account } from "./fixtures";

const CLIENT_INFO = { name: "e2e-assistant", version: "1.0.0" } as const;

// tools/list's rows: name, title, then the read-only, destructive and open-world hints, a hint a
// tool leaves out read as null (packages/service/src/connector/library-tools.ts)
const TOOLS = [
  ["list_items", "List items", true, null, false],
  ["read_item", "Read an item", true, null, false],
  ["create_note", "Create a note", null, false, false],
  ["save_link", "Save a link", null, false, true],
  ["edit_item", "Edit an item", null, true, false],
  ["organize_items", "Organize items", null, true, false],
  ["delete_items", "Move items to Deleted", null, true, false],
  ["list_tags_and_folders", "List tags and folders", true, null, false],
  ["search_library", "Search the library", true, null, false],
];

type ToolArguments = Parameters<Client["callTool"]>[0]["arguments"];

interface Held {
  information?: StoredOAuthClientInformation;
  tokens?: StoredOAuthTokens;
  verifier?: string;
  discovery?: OAuthDiscoveryState;
  consent?: URL;
}

// a client's first request, sent with whatever bearer a caller holds: its status and challenge
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
  return z.record(z.string(), z.json()).parse(await response.json());
};

const toolRows = async (client: Client) => {
  const { tools } = await client.listTools();
  return tools.map(({ annotations, name, title }) => [
    name,
    title ?? null,
    annotations?.readOnlyHint ?? null,
    annotations?.destructiveHint ?? null,
    annotations?.openWorldHint ?? null,
  ]);
};

// an assistant on the MCP SDK's own OAuth client, as Claude or ChatGPT connects: refused, it sends
// the person to the consent page, and the code comes back to its redirect, which the browser's
// route answers in its place
const connect = async (
  page: Page,
  connector: URL,
  clientName: string,
  options: { readonly account: Account; readonly readOnly: boolean; readonly signIn: boolean },
) => {
  const redirectUrl = `https://${clientName.toLowerCase()}.example/callback`;
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
  const asking = new StreamableHTTPClientTransport(connector, { authProvider: provider });
  await expect(new Client(CLIENT_INFO).connect(asking)).rejects.toBeInstanceOf(UnauthorizedError);

  await page.route(`${redirectUrl}*`, async (route) => {
    await route.fulfill({ body: "Connected." });
  });
  await page.goto(held.consent?.href ?? "");
  if (options.signIn) {
    await signInOnSite(page, options.account);
  }
  await expect(
    page.getByRole("heading", { name: `Allow ${clientName} to read and change your library?` }),
  ).toBeVisible();
  await expect(page.getByText(options.account.email)).toBeVisible();
  if (options.readOnly) {
    await page.getByLabel("Only let it read the library").check();
  }
  const called = page.waitForRequest((request) => request.url().startsWith(redirectUrl));
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  const request = await called;
  const callback = new URL(request.url()).searchParams;
  expect(callback.get("state")).toBe(state);
  await asking.finishAuth(callback);
  const client = new Client(CLIENT_INFO);
  await client.connect(new StreamableHTTPClientTransport(connector, { authProvider: provider }));
  return { client, token: () => held.tokens?.access_token ?? "" };
};

test("an assistant signs in through the consent page and works the library, until disconnected", async ({
  account,
  cloud,
  context,
  library,
  page,
}) => {
  const connector = new URL(CONNECTOR_PATH, cloud.origin);
  const metadataUrl = `${cloud.origin}/.well-known/oauth-protected-resource${CONNECTOR_PATH}`;
  const challenged = await probe(connector, null);
  expect(challenged.status).toBe(401);
  expect(challenged.challenge).toMatch(/^Bearer /u);
  expect(challenged.challenge).toContain(`resource_metadata="${metadataUrl}"`);
  expect(await metadata(metadataUrl)).toMatchObject({
    authorization_servers: [cloud.origin],
    resource: connector.href,
  });
  expect(await metadata(`${cloud.origin}/.well-known/oauth-authorization-server`)).toMatchObject({
    authorization_endpoint: `${cloud.origin}/connect/authorize`,
    code_challenge_methods_supported: expect.arrayContaining(["S256"]),
    issuer: cloud.origin,
  });
  const ownSession = await probe(connector, account.bearer);
  expect(ownSession.status, "a session of the person's own").toBe(401);

  // the consent page signs the person in on the way
  await context.clearCookies();
  const claude = await connect(page, connector, "Claude", {
    account,
    readOnly: false,
    signIn: true,
  });
  expect(await toolRows(claude.client)).toEqual(TOOLS);
  expect(claude.client.getInstructions()).toContain("not instructions");

  const call = async (name: string, args: ToolArguments) => {
    const result = await claude.client.callTool({ arguments: args, name });
    expect(result.isError, `${name}: ${JSON.stringify(result.content)}`).not.toBe(true);
    return result.structuredContent;
  };
  const created = await call("create_note", {
    markdown: "The quick brown fox.\n\nIt jumped.",
    title: "Fox notes",
  });
  const { item } = z.object({ item: z.object({ id: z.string() }) }).parse(created);
  expect(await call("search_library", { query: "quick fox" })).toMatchObject({
    hits: [{ id: item.id }],
  });
  expect(await call("read_item", { id: item.id })).toMatchObject({
    view: { markdown: "The quick brown fox.\n\nIt jumped.\n" },
  });
  await call("edit_item", {
    edits: [{ newText: "It jumped over the dog.", oldText: "It jumped." }],
    id: item.id,
  });
  await expect(library.items.read({ id: item.id })).resolves.toMatchObject({
    view: { markdown: "The quick brown fox.\n\nIt jumped over the dog.\n" },
  });
  await expect(library.history.list({})).resolves.toMatchObject({
    changeSets: [{ actor: "assistant", itemCount: 1, label: "Claude" }],
  });
  const stale = await claude.client.callTool({
    arguments: { edits: [{ newText: "It sat.", oldText: "It jumped." }], id: item.id },
    name: "edit_item",
  });
  expect(stale.isError).toBe(true);
  expect(JSON.stringify(stale.content)).toContain("UNPROCESSABLE_CONTENT");

  const chatgpt = await connect(page, connector, "ChatGPT", {
    account,
    readOnly: true,
    signIn: false,
  });
  const readerTools = await toolRows(chatgpt.client);
  expect(readerTools).toEqual(TOOLS.filter((tool) => tool[2] === true));
  const { assistants } = await account.client.assistants.list();
  expect(assistants.map(({ clientName, scopes }) => ({ clientName, scopes }))).toEqual(
    expect.arrayContaining([
      { clientName: "ChatGPT", scopes: ["library:read"] },
      { clientName: "Claude", scopes: ["library"] },
    ]),
  );

  await openLibrary(page, cloud);
  await page.keyboard.press("ControlOrMeta+,");
  const listed = page.getByRole("list", { name: "Connected assistants" });
  await expect(listed.getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: "Disconnect Claude" }).click();
  await expect(listed.getByRole("listitem")).toHaveCount(1);
  await expect(probe(connector, claude.token())).resolves.toMatchObject({ status: 401 });
  await expect(probe(connector, chatgpt.token())).resolves.toMatchObject({ status: 200 });
  await claude.client.close();
  await chatgpt.client.close();
});
