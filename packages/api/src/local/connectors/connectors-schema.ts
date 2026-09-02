// secrets never transit a read: the write path accepts full header values, every response reduces them to hasAuth

import { z } from "zod";

export const CONNECTOR_NAME_PATTERN = /^[A-Za-z0-9_-]+$/u;
export const CONNECTOR_NAME_MAX_LENGTH = 64;
export const CONNECTOR_ARGS_MAX = 64;
export const CONNECTOR_HEADERS_MAX = 16;

export const connectorNameSchema = z
  .string()
  .min(1)
  .max(CONNECTOR_NAME_MAX_LENGTH)
  .regex(CONNECTOR_NAME_PATTERN, "use letters, numbers, '-' and '_' only");

const HTTP_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

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

export const CONNECTOR_SCOPES_MAX = 32;

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
  // tokens are never input: they arrive through the callback, live in the store, and read back as a status
  z
    .object({
      kind: z.literal("oauth"),
      url: connectorUrlSchema,
      authorizationEndpoint: connectorUrlSchema,
      tokenEndpoint: connectorUrlSchema,
      clientId: z.string().min(1),
      scopes: z.array(z.string().min(1)).max(CONNECTOR_SCOPES_MAX),
    })
    .strict(),
]);
export type ConnectorTransportInput = z.infer<typeof connectorTransportInputSchema>;

// needs-reauth: a refresh the provider refused
export const connectorOauthStatusSchema = z.enum(["needs-auth", "connected", "needs-reauth"]);
export type ConnectorOauthStatus = z.infer<typeof connectorOauthStatusSchema>;

export const connectorTransportViewSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("stdio"),
      command: z.string().min(1),
      args: z.array(z.string()),
    })
    .strict(),
  z.object({ kind: z.literal("http"), url: z.string().min(1), hasAuth: z.boolean() }).strict(),
  z
    .object({
      kind: z.literal("oauth"),
      url: z.string().min(1),
      authorizationEndpoint: z.string().min(1),
      tokenEndpoint: z.string().min(1),
      clientId: z.string().min(1),
      scopes: z.array(z.string()),
      status: connectorOauthStatusSchema,
    })
    .strict(),
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

export function connectorTarget(transport: ConnectorTransportView): string {
  switch (transport.kind) {
    case "stdio":
      return [transport.command, ...transport.args].join(" ");
    case "http":
    case "oauth":
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

export const connectorRemoveRequestSchema = z.object({ name: connectorNameSchema }).strict();
export type ConnectorRemoveRequest = z.infer<typeof connectorRemoveRequestSchema>;

export const connectorToggleRequestSchema = z
  .object({ name: connectorNameSchema, enabled: z.boolean() })
  .strict();
export type ConnectorToggleRequest = z.infer<typeof connectorToggleRequestSchema>;

// a plain route, not a procedure: the provider's consent page redirects a browser here, which wants a page
export const CONNECTOR_OAUTH_CALLBACK_PATH = "/connectors/oauth/callback";

export const connectorOauthBeginRequestSchema = z
  .object({
    name: connectorNameSchema,
    // required, not defaulted: the caller that must say false is the one a default lets forget
    open: z.boolean(),
  })
  .strict();
export type ConnectorOauthBeginRequest = z.infer<typeof connectorOauthBeginRequestSchema>;

export const connectorOauthBeginResponseSchema = z
  .object({ url: z.string().min(1), opened: z.boolean() })
  .strict();
export type ConnectorOauthBeginResponse = z.infer<typeof connectorOauthBeginResponseSchema>;

export const connectorOauthDisconnectRequestSchema = z
  .object({ name: connectorNameSchema })
  .strict();
export type ConnectorOauthDisconnectRequest = z.infer<typeof connectorOauthDisconnectRequestSchema>;
