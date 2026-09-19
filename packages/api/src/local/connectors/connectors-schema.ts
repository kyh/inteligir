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
      args: z.array(z.string().min(1)).max(CONNECTOR_ARGS_MAX),
      command: z.string().min(1),
      kind: z.literal("stdio"),
    })
    .strict(),
  z
    .object({
      headers: z
        .record(z.string().min(1), z.string().min(1))
        .refine((value) => Object.keys(value).length <= CONNECTOR_HEADERS_MAX, {
          message: `at most ${String(CONNECTOR_HEADERS_MAX)} headers`,
        })
        .optional(),
      kind: z.literal("http"),
      url: connectorUrlSchema,
    })
    .strict(),
  // tokens are never input: they arrive through the callback, live in the store, and read back as a status
  z
    .object({
      authorizationEndpoint: connectorUrlSchema,
      clientId: z.string().min(1),
      kind: z.literal("oauth"),
      scopes: z.array(z.string().min(1)).max(CONNECTOR_SCOPES_MAX),
      tokenEndpoint: connectorUrlSchema,
      url: connectorUrlSchema,
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
      args: z.array(z.string()),
      command: z.string().min(1),
      kind: z.literal("stdio"),
    })
    .strict(),
  z.object({ hasAuth: z.boolean(), kind: z.literal("http"), url: z.string().min(1) }).strict(),
  z
    .object({
      authorizationEndpoint: z.string().min(1),
      clientId: z.string().min(1),
      kind: z.literal("oauth"),
      scopes: z.array(z.string()),
      status: connectorOauthStatusSchema,
      tokenEndpoint: z.string().min(1),
      url: z.string().min(1),
    })
    .strict(),
]);
export type ConnectorTransportView = z.infer<typeof connectorTransportViewSchema>;

export const connectorViewSchema = z
  .object({
    enabled: z.boolean(),
    name: z.string().min(1),
    transport: connectorTransportViewSchema,
  })
  .strict();
export type ConnectorView = z.infer<typeof connectorViewSchema>;

export const connectorTarget = (transport: ConnectorTransportView): string => {
  switch (transport.kind) {
    case "stdio": {
      return [transport.command, ...transport.args].join(" ");
    }
    case "http":
    case "oauth": {
      return transport.url;
    }
    // no default
  }
};

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
  .object({ enabled: z.boolean(), name: connectorNameSchema })
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
  .object({ opened: z.boolean(), url: z.string().min(1) })
  .strict();
export type ConnectorOauthBeginResponse = z.infer<typeof connectorOauthBeginResponseSchema>;

export const connectorOauthDisconnectRequestSchema = z
  .object({ name: connectorNameSchema })
  .strict();
export type ConnectorOauthDisconnectRequest = z.infer<typeof connectorOauthDisconnectRequestSchema>;
