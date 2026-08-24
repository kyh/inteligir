// The connectors payload vocabulary: the MCP servers every agent session gets.
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

import { z } from "zod";

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
  // An OAuth row carries the provider's coordinates only. Tokens are never
  // part of the input — they arrive through the authorize flow's callback and
  // live in the store, and the view reduces them to a status.
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

/**
 * What a caller ever READS. Header values are reduced to `hasAuth` — the row
 * can say "authenticated" without a response ever carrying a key.
 */
/** Where an OAuth row stands: no tokens yet, tokens held, or a refresh the
 *  provider refused — the row's Connect button reads this, nothing else does. */
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

/** What a configured server IS, in one line — beside the vocabulary because
 *  both surfaces (the settings row, `inteligir connectors list`) render it. */
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

/** The browser lands here after the provider's consent page; outside the
 *  contract table for pair-callback's own reason (a browser wants a page). */
export const CONNECTOR_OAUTH_CALLBACK_PATH = "/connectors/oauth/callback";

export const connectorOauthBeginRequestSchema = z
  .object({
    name: connectorNameSchema,
    // Required, not defaulted: the caller that must say false is exactly the
    // one a default would let forget (the pairing precedent).
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
