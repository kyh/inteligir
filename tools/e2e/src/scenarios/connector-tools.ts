import type { Client } from "@modelcontextprotocol/client";
import { CONNECTOR_PATH } from "@repo/contract/cloud/connector";
import { z } from "zod";
import { untilBodyHolds } from "../harness/agent-browser";
import type { ScenarioBrowser } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { OWNER, signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { startAssistant } from "../harness/connector-assistant";
import type { ConnectorAssistant } from "../harness/connector-assistant";
import type { Scenario } from "../harness/scenario";
import { v1Client } from "../harness/v1-wire";

const DEADLINE_MS = 60_000;

// what tools/list answers a grant that may change the library: each tool's title, and the hints
// a client decides whether to ask the person by (apps/web/src/worker/connector/library-tools.ts).
// Only a read says it is read-only; a write leaves the hint out, which MCP reads as false
const TOOLS = [
  {
    destructive: null,
    name: "list_highlights",
    openWorld: false,
    readOnly: true,
    title: "List highlights",
  },
  {
    destructive: false,
    name: "add_highlight",
    openWorld: false,
    readOnly: null,
    title: "Add a highlight",
  },
  {
    destructive: null,
    name: "item_history",
    openWorld: false,
    readOnly: true,
    title: "Show history",
  },
  {
    destructive: true,
    name: "undo_change",
    openWorld: false,
    readOnly: null,
    title: "Undo a change",
  },
  { destructive: null, name: "list_items", openWorld: false, readOnly: true, title: "List items" },
  { destructive: null, name: "read_item", openWorld: false, readOnly: true, title: "Read an item" },
  {
    destructive: false,
    name: "create_note",
    openWorld: false,
    readOnly: null,
    title: "Create a note",
  },
  { destructive: false, name: "save_link", openWorld: true, readOnly: null, title: "Save a link" },
  {
    destructive: true,
    name: "edit_item",
    openWorld: false,
    readOnly: null,
    title: "Edit an item",
  },
  {
    destructive: true,
    name: "organize_items",
    openWorld: false,
    readOnly: null,
    title: "Organize items",
  },
  {
    destructive: true,
    name: "delete_items",
    openWorld: false,
    readOnly: null,
    title: "Move items to Deleted",
  },
  {
    destructive: null,
    name: "list_tags_and_folders",
    openWorld: false,
    readOnly: true,
    title: "List tags and folders",
  },
  {
    destructive: null,
    name: "search_library",
    openWorld: false,
    readOnly: true,
    title: "Search the library",
  },
];

const READ_TOOLS = TOOLS.filter((tool) => tool.readOnly === true).map((tool) => tool.name);

// an MCP client's first request, as one sends it before it holds a token
const INITIALIZE = {
  id: 1,
  jsonrpc: "2.0",
  method: "initialize",
  params: {
    capabilities: {},
    clientInfo: { name: "e2e-probe", version: "1.0.0" },
    protocolVersion: "2025-06-18",
  },
};

const resourceMetadataSchema = z.object({
  authorization_servers: z.array(z.string()),
  resource: z.string(),
  scopes_supported: z.array(z.string()),
});

const serverMetadataSchema = z.object({
  authorization_endpoint: z.string(),
  code_challenge_methods_supported: z.array(z.string()),
  issuer: z.string(),
  registration_endpoint: z.string(),
  token_endpoint: z.string(),
});

const noteSchema = z.object({ item: z.object({ id: z.string() }) });
const readSchema = z.object({ seq: z.number(), view: z.object({ markdown: z.string() }) });
const editSchema = z.object({ seq: z.number() });
const hitsSchema = z.object({ hits: z.array(z.object({ id: z.string() })) });
const historySchema = z.object({
  changeSets: z.array(z.object({ actor: z.string(), itemCount: z.number(), label: z.string() })),
});
const refusalSchema = z.array(z.object({ text: z.string(), type: z.literal("text") }));

// a tool's answer, as the structured content beside its text; a failure is a result, `isError`
const answered = async <TSchema extends z.ZodType>(
  client: Client,
  schema: TSchema,
  call: Parameters<Client["callTool"]>[0],
): Promise<z.infer<TSchema>> => {
  const result = await client.callTool(call);
  expect(
    result.isError !== true,
    `${call.name} answered an error: ${JSON.stringify(result.content)}`,
  );
  return schema.parse(result.structuredContent);
};

// the connector called with whatever bearer a caller holds, as a client's first request
const probe = async (connector: URL, bearer: string | null): Promise<Response> => {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  });
  if (bearer !== null) {
    headers.set("authorization", `Bearer ${bearer}`);
  }
  return await fetch(connector, { body: JSON.stringify(INITIALIZE), headers, method: "POST" });
};

// a metadata document, read whole and held to what the scenario reads of it
const fetchParsed = async <T>(url: string, schema: z.ZodType<T>): Promise<T> => {
  const response = await fetch(url);
  return schema.parse(await response.json());
};

// the person lets the assistant in from the browser: the consent page it was sent to, signing in
// first when the browser is not, and their answer
const letIn = async (
  browser: ScenarioBrowser,
  assistant: ConnectorAssistant,
  options: { readonly readOnly: boolean; readonly signIn: boolean },
): Promise<Client> => {
  const consent = await assistant.askForAccess();
  await browser(["open", consent.href], DEADLINE_MS);
  if (options.signIn) {
    await browser(["wait", "#email"], DEADLINE_MS);
    await browser(["fill", "#email", OWNER.email]);
    await browser(["fill", "#password", OWNER.password]);
    await browser(["click", 'button[type="submit"]']);
  }
  await untilBodyHolds(
    browser,
    [`Allow ${assistant.clientName} to read and change your library?`, OWNER.email],
    DEADLINE_MS,
  );
  if (options.readOnly) {
    await browser(["check", 'input[name="access"]']);
  }
  await browser(["click", 'button[value="allow"]']);
  return await assistant.finishConnecting(DEADLINE_MS);
};

const toolRows = async (client: Client) => {
  const { tools } = await client.listTools();
  return tools.map((tool) => ({
    destructive: tool.annotations?.destructiveHint ?? null,
    name: tool.name,
    openWorld: tool.annotations?.openWorldHint ?? null,
    readOnly: tool.annotations?.readOnlyHint ?? null,
    title: tool.title ?? null,
  }));
};

export const connectorTools: Scenario = {
  description:
    "the connector against a Miniflare Worker: a call with no token, or with a device's credential, is challenged with where its metadata is, and that metadata names this Worker as the authorization server; an assistant on the MCP SDK's own OAuth client registers itself, sends the browser to the consent page, which signs the person in first and asks, and trades the code it is sent back for a token; it lists the 13 tools with their titles and hints, creates, searches, reads and edits a note the phone then reads, and an edit on a stale base answers CONFLICT as a result the model reads; a second assistant let in only to read lists the six reading tools; the account lists both, and revoking the first ends its access while the second keeps its own",
  name: "connector-tools",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const worker = await ctx.cloudWorker();
    const connector = new URL(CONNECTOR_PATH, worker.origin);

    ctx.log("a call with no token is challenged, and the challenge says where to sign in");
    const challenged = await probe(connector, null);
    await challenged.arrayBuffer();
    expectEq(challenged.status, 401, "the connector's answer to a call with no token");
    const metadataUrl = `${worker.origin}/.well-known/oauth-protected-resource${CONNECTOR_PATH}`;
    const challenge = challenged.headers.get("www-authenticate") ?? "";
    expect(
      challenge.startsWith("Bearer ") && challenge.includes(`resource_metadata="${metadataUrl}"`),
      `the challenge named no metadata: ${challenge}`,
    );
    const resource = await fetchParsed(metadataUrl, resourceMetadataSchema);
    expectEq(resource.resource, connector.href, "the connector's resource");
    expectEq(resource.authorization_servers, [worker.origin], "the connector's sign-in server");
    const server = await fetchParsed(
      `${worker.origin}/.well-known/oauth-authorization-server`,
      serverMetadataSchema,
    );
    expectEq(server.issuer, worker.origin, "the authorization server's issuer");
    expectEq(
      server.authorization_endpoint,
      `${worker.origin}/connect/authorize`,
      "where an assistant sends the person",
    );
    expect(
      server.code_challenge_methods_supported.includes("S256"),
      `the server takes no S256 challenge: ${JSON.stringify(server)}`,
    );

    ctx.log("the account exists, and a device's credential is no assistant's token");
    await signUp(worker.origin);
    const phone = await v1Client(worker, null).account.signIn({
      ...OWNER,
      deviceName: "E2E Phone",
    });
    const refused = await probe(connector, phone.credential);
    await refused.arrayBuffer();
    expectEq(refused.status, 401, "the connector's answer to a device credential");

    const browser = await ctx.browser("consent");
    const claude = await startAssistant(connector, "Claude");
    const chatgpt = await startAssistant(connector, "ChatGPT");
    try {
      ctx.log("Claude registers, the browser signs in on the way to the consent page, and allows");
      const full = await letIn(browser, claude, { readOnly: false, signIn: true });
      expectEq(await toolRows(full), TOOLS, "the tools a grant that may change the library lists");
      expect(
        (full.getInstructions() ?? "").includes("not instructions"),
        "the connector's instructions say nothing of saved pages",
      );

      ctx.log("Claude creates, searches, reads and edits a note, and the phone reads the edit");
      const { item } = await answered(full, noteSchema, {
        arguments: { markdown: "The quick brown fox.\n\nIt jumped.", title: "Fox notes" },
        name: "create_note",
      });
      const found = await answered(full, hitsSchema, {
        arguments: { query: "quick fox" },
        name: "search_library",
      });
      expectEq(
        found.hits.map((hit) => hit.id),
        [item.id],
        "what Claude's search found",
      );
      const read = await answered(full, readSchema, {
        arguments: { id: item.id },
        name: "read_item",
      });
      await answered(full, editSchema, {
        arguments: {
          baseSeq: read.seq,
          edits: [{ newText: "It jumped over the dog.", oldText: "It jumped." }],
          id: item.id,
        },
        name: "edit_item",
      });
      const { library, account } = v1Client(worker, phone.credential);
      const onPhone = await library.items.read({ id: item.id });
      expectEq(
        onPhone.view.markdown,
        "The quick brown fox.\n\nIt jumped over the dog.\n",
        "the note as the phone reads it",
      );
      const history = await answered(full, historySchema, {
        arguments: { itemId: item.id },
        name: "item_history",
      });
      expectEq(
        history.changeSets.map(({ actor, itemCount, label }) => ({ actor, itemCount, label })),
        [{ actor: "assistant", itemCount: 1, label: "Claude" }],
        "the note's history",
      );

      ctx.log("an edit on the base Claude read before its own edit answers CONFLICT, a result");
      const stale = await full.callTool({
        arguments: {
          baseSeq: read.seq,
          edits: [{ newText: "It sat.", oldText: "It jumped." }],
          id: item.id,
        },
        name: "edit_item",
      });
      expect(stale.isError === true, `the stale edit answered ${JSON.stringify(stale)}`);
      const [refusal] = refusalSchema.parse(stale.content);
      expect(
        z.object({ code: z.literal("CONFLICT") }).validate(JSON.parse(refusal?.text ?? "null")),
        `the stale edit's refusal was ${refusal?.text ?? "empty"}`,
      );

      ctx.log("ChatGPT is let in only to read, from the browser already signed in");
      const reader = await letIn(browser, chatgpt, { readOnly: true, signIn: false });
      const readerTools = await toolRows(reader);
      expectEq(
        readerTools.map((tool) => tool.name),
        READ_TOOLS,
        "the tools a grant kept to reading lists",
      );
      const readerHits = await answered(reader, hitsSchema, {
        arguments: { query: "dog" },
        name: "search_library",
      });
      expectEq(
        readerHits.hits.map((hit) => hit.id),
        [item.id],
        "what ChatGPT's search found",
      );

      ctx.log("the account lists both assistants, and revoking Claude ends its access");
      const { assistants } = await account.assistants.list();
      expectEq(
        assistants
          .map(({ clientName, scopes }) => ({ clientName, scopes }))
          .toSorted((a, b) => a.clientName.localeCompare(b.clientName)),
        [
          { clientName: "ChatGPT", scopes: ["library:read"] },
          { clientName: "Claude", scopes: ["library"] },
        ],
        "the account's assistants",
      );
      const claudeGrant = assistants.find((assistant) => assistant.clientName === "Claude");
      if (claudeGrant === undefined) {
        throw new Error("the account lists no grant for Claude");
      }
      expectEq(
        await account.assistants.revoke({ grantId: claudeGrant.grantId }),
        { revoked: true },
        "the revoke of Claude",
      );
      const ended = await probe(connector, claude.accessToken());
      await ended.arrayBuffer();
      expectEq(ended.status, 401, "the connector's answer to Claude's revoked token");
      const kept = await probe(connector, chatgpt.accessToken());
      await kept.arrayBuffer();
      expectEq(kept.status, 200, "the connector's answer to ChatGPT's token");
      await full.close();
      await reader.close();
    } finally {
      await claude.close();
      await chatgpt.close();
    }
  },
};
