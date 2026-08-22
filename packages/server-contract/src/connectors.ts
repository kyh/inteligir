// The connectors wire contract: the MCP servers every agent session gets.
//
// The registry is THIS APP'S OWN (issue #591, reversing the codex-owned
// decision — its premise, codex as the only harness, died with ACP). One
// store in the data dir; session creation composes the enabled rows into
// ACP `session/new`'s mcpServers, identically for every harness, so
// "configured once, shared by every agent" is a property of the launch path
// rather than a promise about config files.
//
// SECRETS NEVER TRANSIT A READ. An http row may carry auth headers; every
// response reduces them to `hasAuth: true`. The write path accepts full
// values, and an update that OMITS headers keeps the stored ones — so a rename
// of a URL never forces re-pasting a key, and no client ever holds one to
// leak back.

import type { EmptyInput } from "@repo/typed-routes/endpoint";
import {
  defineRoute,
  jsonRequest,
  jsonResponse,
  noRequest,
} from "@repo/typed-routes/route-descriptor";
import { z } from "zod";
import type { ApiErrorResponse } from "./errors";

/** One grammar, two readers: the add form refuses before the round trip and
 *  the server refuses regardless. */
export const CONNECTOR_NAME_PATTERN = /^[A-Za-z0-9_-]+$/u;
export const CONNECTOR_NAME_MAX_LENGTH = 64;
/** A ceiling on the argv a user can hand a spawned server; not a security
 *  bound (argv is passed as a list, never through a shell), just a bound. */
export const CONNECTOR_ARGS_MAX = 64;
export const CONNECTOR_HEADERS_MAX = 16;

export const connectorNameSchema = z
  .string()
  .min(1)
  .max(CONNECTOR_NAME_MAX_LENGTH)
  .regex(CONNECTOR_NAME_PATTERN, "use letters, numbers, '-' and '_' only");

const HTTP_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

/** An http(s) URL, parsed rather than pattern-matched — the only gate between
 *  a typo and a server that can never connect. */
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
 * What a caller may WRITE. Http headers are the auth channel (a bearer or an
 * api key header); omitted on update, the stored ones survive.
 */
export const connectorTransportInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("stdio"),
      command: z.string().min(1),
      args: z.array(z.string().min(1)).max(CONNECTOR_ARGS_MAX),
    })
    .strict(),
  z
    .object({
      kind: z.literal("http"),
      url: connectorUrlSchema,
      headers: z
        .record(z.string().min(1), z.string().min(1))
        .refine((value) => Object.keys(value).length <= CONNECTOR_HEADERS_MAX, {
          message: `at most ${String(CONNECTOR_HEADERS_MAX)} headers`,
        })
        .optional(),
    })
    .strict(),
]);
export type ConnectorTransportInput = z.infer<typeof connectorTransportInputSchema>;

/**
 * What a caller ever READS. Header values are reduced to `hasAuth` — the row
 * can say "authenticated" without a response ever carrying a key.
 */
export const connectorTransportViewSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("stdio"),
      command: z.string().min(1),
      args: z.array(z.string()),
    })
    .strict(),
  z.object({ kind: z.literal("http"), url: z.string().min(1), hasAuth: z.boolean() }).strict(),
]);
export type ConnectorTransportView = z.infer<typeof connectorTransportViewSchema>;

export const connectorViewSchema = z
  .object({
    name: z.string().min(1),
    enabled: z.boolean(),
    transport: connectorTransportViewSchema,
  })
  .strict();
export type ConnectorView = z.infer<typeof connectorViewSchema>;

/** What a configured server IS, in one line — beside the vocabulary because
 *  both surfaces (the settings row, `inteligir connectors list`) render it. */
export function connectorTarget(transport: ConnectorTransportView): string {
  switch (transport.kind) {
    case "stdio":
      return [transport.command, ...transport.args].join(" ");
    case "http":
      return transport.url;
  }
}

export const connectorsResponseSchema = z
  .object({ servers: z.array(connectorViewSchema) })
  .strict();
export type ConnectorsResponse = z.infer<typeof connectorsResponseSchema>;

export const connectorAddRequestSchema = z
  .object({ name: connectorNameSchema, transport: connectorTransportInputSchema })
  .strict();
export type ConnectorAddRequest = z.infer<typeof connectorAddRequestSchema>;

export const connectorUpdateRequestSchema = z
  .object({ name: connectorNameSchema, transport: connectorTransportInputSchema })
  .strict();
export type ConnectorUpdateRequest = z.infer<typeof connectorUpdateRequestSchema>;

export const connectorRemoveRequestSchema = z.object({ name: connectorNameSchema }).strict();
export type ConnectorRemoveRequest = z.infer<typeof connectorRemoveRequestSchema>;

export const connectorToggleRequestSchema = z
  .object({ name: connectorNameSchema, enabled: z.boolean() })
  .strict();
export type ConnectorToggleRequest = z.infer<typeof connectorToggleRequestSchema>;

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
      jsonResponse<ConnectorsResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 400 }),
      jsonResponse<ApiErrorResponse>({ status: 409 }),
    ] as const,
  }),
  update: defineRoute({
    path: "/connectors/update",
    method: "post",
    request: jsonRequest<EmptyInput, ConnectorUpdateRequest>(connectorUpdateRequestSchema),
    response: [
      jsonResponse<ConnectorsResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 400 }),
      jsonResponse<ApiErrorResponse>({ status: 404 }),
    ] as const,
  }),
  remove: defineRoute({
    path: "/connectors/remove",
    method: "post",
    request: jsonRequest<EmptyInput, ConnectorRemoveRequest>(connectorRemoveRequestSchema),
    response: [
      jsonResponse<ConnectorsResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 400 }),
      jsonResponse<ApiErrorResponse>({ status: 404 }),
    ] as const,
  }),
  toggle: defineRoute({
    path: "/connectors/toggle",
    method: "post",
    request: jsonRequest<EmptyInput, ConnectorToggleRequest>(connectorToggleRequestSchema),
    response: [
      jsonResponse<ConnectorsResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 400 }),
      jsonResponse<ApiErrorResponse>({ status: 404 }),
    ] as const,
  }),
};
