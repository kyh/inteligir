// How the fake's agent calls a tool: as Anthropic's MCP proxy does, with the access token of the
// session vault's credential for that server's address, refreshed at the credential's own token
// endpoint when the server answers 401 (platform.claude.com/docs/en/managed-agents/vaults). A
// fresh MCP client a call, since the connector serves every request statelessly.

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { z } from "zod";

import type { ToolInput } from "./fake-script.ts";

// a vault's `mcp_oauth` credential as the cell creates it; an update merges into it
export const mcpOAuthSchema = z.object({
  access_token: z.string().min(1),
  expires_at: z.string().optional(),
  mcp_server_url: z.url(),
  refresh: z
    .object({
      client_id: z.string().min(1),
      refresh_token: z.string().min(1),
      resource: z.string().optional(),
      scope: z.string().optional(),
      token_endpoint: z.url(),
      // the API takes `none` for a public client, the one kind the fake refreshes as
      token_endpoint_auth: z.object({ type: z.literal("none") }),
    })
    .optional(),
  type: z.literal("mcp_oauth"),
});

export type McpOAuth = z.infer<typeof mcpOAuthSchema>;

// the server a credential answers for, compared as the API compares them: origin and path, no
// trailing slash
export const serverKey = (url: string): string => {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/u, "")}`;
};

const refreshedSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(1).optional(),
});

export type ConnectorFetch = (request: Request) => Promise<Response>;

// the credential's tokens renewed at its own endpoint, as the proxy renews an expired one; null
// when it holds no refresh block or the endpoint refuses
const refreshed = async (fetch: ConnectorFetch, held: McpOAuth): Promise<McpOAuth | null> => {
  const { refresh } = held;
  if (refresh === undefined) {
    return null;
  }
  const form = new URLSearchParams({
    client_id: refresh.client_id,
    grant_type: "refresh_token",
    refresh_token: refresh.refresh_token,
  });
  if (refresh.resource !== undefined) {
    form.set("resource", refresh.resource);
  }
  const response = await fetch(new Request(refresh.token_endpoint, { body: form, method: "POST" }));
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  const tokens = refreshedSchema.parse(await response.json());
  return {
    ...held,
    access_token: tokens.access_token,
    refresh: { ...refresh, refresh_token: tokens.refresh_token ?? refresh.refresh_token },
  };
};

export interface TextBlock {
  readonly type: "text";
  readonly text: string;
}

export type ToolOutcome =
  | { readonly kind: "result"; readonly content: readonly TextBlock[]; readonly isError: boolean }
  // the server refused the credential even after a refresh
  | { readonly kind: "unauthorized"; readonly message: string };

const contentSchema = z.array(z.looseObject({ text: z.string().optional(), type: z.string() }));

// what a tool answered, as text blocks: a block of another kind is written as its JSON
const textBlocksOf = (content: z.infer<typeof contentSchema>): TextBlock[] =>
  content.map((block) => ({ text: block.text ?? JSON.stringify(block), type: "text" as const }));

export const callTool = async (call: {
  readonly fetch: ConnectorFetch;
  readonly serverUrl: string;
  // the credential the session's vaults hold for the server, and where a renewed one goes
  readonly credential: McpOAuth | null;
  readonly renew: (renewed: McpOAuth) => void;
  readonly tool: string;
  readonly input: ToolInput;
}): Promise<ToolOutcome> => {
  let held = call.credential;
  let unauthorized = false;
  const client = new Client({ name: "managed-agents-fake", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(call.serverUrl), {
    authProvider: {
      onUnauthorized: async () => {
        const renewed = held === null ? null : await refreshed(call.fetch, held);
        if (renewed === null) {
          unauthorized = true;
          return;
        }
        held = renewed;
        call.renew(renewed);
      },
      token: async () => await Promise.resolve(held?.access_token),
    },
    fetch: async (input, init) => await call.fetch(new Request(input, init)),
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ arguments: call.input, name: call.tool });
    return {
      content: textBlocksOf(contentSchema.parse(result.content)),
      isError: result.isError === true,
      kind: "result",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "the call failed";
    return unauthorized
      ? { kind: "unauthorized", message }
      : { content: [{ text: message, type: "text" }], isError: true, kind: "result" };
  } finally {
    await client.close();
  }
};
