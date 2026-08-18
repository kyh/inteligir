// The connectors wire contract: the MCP servers the coding agent can talk to.
//
// This app keeps NO connector state of its own. Codex already manages MCP
// servers (`codex mcp list|get|add|remove`, stored in `~/.codex/config.toml`),
// and the agent this product drives is codex — so a second registry here would
// be a second answer to "which servers exist" that the agent would ignore. The
// routes below are a typed face over that CLI, and the CLI is the contract:
// what it lists is what the agent gets.
//
// THE READ ANSWERS 200 EITHER WAY. "Codex is not installed" is a legitimate
// answer to "which connectors are configured", the same way the agent block of
// /system/status states an unavailable runtime rather than refusing — so the
// response is a union and the settings section renders the sentence. A WRITE
// has no such answer, and refuses with `provider_unavailable`.

import type { EmptyInput } from "@repo/typed-routes/endpoint";
import {
  defineRoute,
  jsonRequest,
  jsonResponse,
  noRequest,
} from "@repo/typed-routes/route-descriptor";
import { z } from "zod";
import type { ApiErrorResponse } from "./errors";

/**
 * The names codex itself accepts (`invalid server name '…' (use letters,
 * numbers, '-', '_')`). Exported so the add form can refuse before the round
 * trip and the server can refuse regardless — one grammar, two readers.
 */
export const CONNECTOR_NAME_PATTERN = /^[A-Za-z0-9_-]+$/u;
export const CONNECTOR_NAME_MAX_LENGTH = 64;
/** A ceiling on the argv a user can hand a spawned server; not a security
 *  bound (argv is passed as a list, never through a shell), just a bound. */
export const CONNECTOR_ARGS_MAX = 64;

export const connectorNameSchema = z
  .string()
  .min(1)
  .max(CONNECTOR_NAME_MAX_LENGTH)
  .regex(CONNECTOR_NAME_PATTERN, "use letters, numbers, '-' and '_' only");

const HTTP_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

/**
 * An http(s) URL, parsed rather than pattern-matched. Codex accepts ANY string
 * for `--url` (a bare `notaurl` is stored happily and fails at connect time),
 * so this is the only gate between a typo and a server that can never start.
 */
export const connectorUrlSchema = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      return HTTP_PROTOCOLS.has(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "must be an http:// or https:// URL");

/**
 * What a configured server IS, as this app reports it. `other` is not a
 * placeholder: codex may grow a transport this build has never heard of, and
 * dropping such a server from the listing would hide a server the agent still
 * talks to. It carries codex's own word for it so the row can say so.
 */
export const connectorTransportSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("stdio"),
      command: z.string().min(1),
      args: z.array(z.string()),
    })
    .strict(),
  z.object({ kind: z.literal("http"), url: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("other"), summary: z.string().min(1) }).strict(),
]);
export type ConnectorTransport = z.infer<typeof connectorTransportSchema>;

export const connectorSchema = z
  .object({
    name: z.string().min(1),
    enabled: z.boolean(),
    transport: connectorTransportSchema,
    /**
     * Codex's OWN `auth_status` word (`unsupported`, `not_logged_in`,
     * `o_auth`, …), carried opaquely and null when it says nothing. An enum
     * here would be this repo guessing at a vocabulary it does not own: the
     * first word codex adds would either fail the parse or render as a lie.
     * The surface humanises it; nothing branches on it.
     */
    authStatus: z.string().min(1).nullable(),
  })
  .strict();
export type Connector = z.infer<typeof connectorSchema>;

/**
 * What a configured server IS, in one line — the command line codex spawns,
 * or the endpoint it calls. Beside the vocabulary rather than in a surface,
 * because BOTH surfaces render it (the settings row and `inteligir connectors
 * list`) and two tables over three transports typecheck perfectly while saying
 * different things about the third.
 */
export function connectorTarget(transport: ConnectorTransport): string {
  switch (transport.kind) {
    case "stdio":
      return [transport.command, ...transport.args].join(" ");
    case "http":
      return transport.url;
    case "other":
      // A transport a later codex added. The word is codex's, so a row can
      // still name a server the agent talks to rather than dropping it.
      return `${transport.summary} (this build cannot describe this transport)`;
  }
}

export const connectorsResponseSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ready"), servers: z.array(connectorSchema) }).strict(),
  /** Why there is nothing to list — the sentence the settings section shows,
   *  in the shape `AgentStatus.detail` already uses for the same situation. */
  z.object({ state: z.literal("unavailable"), detail: z.string().min(1) }).strict(),
]);
export type ConnectorsResponse = z.infer<typeof connectorsResponseSchema>;

/**
 * What a user may CREATE — two transports, never three. `other` exists only
 * because codex can report one; nothing in this product can make one, so the
 * add form has no way to express it and the handler has no case to refuse.
 */
export const connectorTransportInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("stdio"),
      command: z.string().min(1),
      args: z.array(z.string().min(1)).max(CONNECTOR_ARGS_MAX),
    })
    .strict(),
  z.object({ kind: z.literal("http"), url: connectorUrlSchema }).strict(),
]);
export type ConnectorTransportInput = z.infer<typeof connectorTransportInputSchema>;

export const connectorAddRequestSchema = z
  .object({ name: connectorNameSchema, transport: connectorTransportInputSchema })
  .strict();
export type ConnectorAddRequest = z.infer<typeof connectorAddRequestSchema>;

export const connectorRemoveRequestSchema = z.object({ name: connectorNameSchema }).strict();
export type ConnectorRemoveRequest = z.infer<typeof connectorRemoveRequestSchema>;

/** Both writes answer the whole listing: the caller's next render is the
 *  server's own view of the config file, never the request echoed back. */
export const connectorsMutationResponseSchema = z
  .object({ servers: z.array(connectorSchema) })
  .strict();
export type ConnectorsMutationResponse = z.infer<typeof connectorsMutationResponseSchema>;

export const connectorRoutes = {
  list: defineRoute({
    path: "/connectors",
    method: "get",
    request: noRequest(),
    response: jsonResponse<ConnectorsResponse>(),
  }),
  add: defineRoute({
    path: "/connectors/add",
    method: "post",
    request: jsonRequest<EmptyInput, ConnectorAddRequest>(connectorAddRequestSchema),
    response: [
      jsonResponse<ConnectorsMutationResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 400 }),
      jsonResponse<ApiErrorResponse>({ status: 409 }),
      jsonResponse<ApiErrorResponse, 503>({ status: 503 }),
    ] as const,
  }),
  remove: defineRoute({
    path: "/connectors/remove",
    method: "post",
    request: jsonRequest<EmptyInput, ConnectorRemoveRequest>(connectorRemoveRequestSchema),
    response: [
      jsonResponse<ConnectorsMutationResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 400 }),
      jsonResponse<ApiErrorResponse>({ status: 404 }),
      jsonResponse<ApiErrorResponse, 503>({ status: 503 }),
    ] as const,
  }),
};
