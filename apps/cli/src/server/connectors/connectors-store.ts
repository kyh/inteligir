// carries api keys, so it sits beside server.json at 0600 and not in the vault (pushed) or the
// thread db (synced). a json file, not a db table: a handful of rows read whole per session
// launch, with no query to earn migrations.

import { JsonFileStore } from "../json-file-store";
import { z } from "zod";

import {
  connectorNameSchema,
  connectorUrlSchema,
} from "@repo/api/local/connectors/connectors-schema";

const CONNECTORS_FILE = "connectors.json";

// tokens live on the row, not in a second file that must agree with it.
// expiresAt is epoch seconds, null when the provider named no lifetime.
const storedOauthTokensSchema = z
  .object({
    accessToken: z.string().min(1),
    expiresAt: z.number().int().nullable(),
    refreshToken: z.string().min(1).optional(),
  })
  .strict();
export type StoredOauthTokens = z.infer<typeof storedOauthTokensSchema>;

// kept apart from what the user named, so a disconnect can forget it and the next authorize
// discovers afresh. scopes are the server's own choice, requested when the row names none.
const storedDiscoveredServerSchema = z
  .object({
    authorizationEndpoint: connectorUrlSchema,
    // absent when the row names its own client id. a client is registered for one redirect uri,
    // so an authorize arriving at another registers again.
    registration: z
      .object({ clientId: z.string().min(1), redirectUri: z.string().min(1) })
      .strict()
      .optional(),
    scopes: z.array(z.string().min(1)),
    tokenEndpoint: connectorUrlSchema,
  })
  .strict();
export type StoredDiscoveredServer = z.infer<typeof storedDiscoveredServerSchema>;

const storedTransportSchema = z.discriminatedUnion("kind", [
  z
    .object({
      args: z.array(z.string()),
      command: z.string().min(1),
      kind: z.literal("stdio"),
    })
    .strict(),
  z
    .object({
      headers: z.record(z.string().min(1), z.string().min(1)).optional(),
      kind: z.literal("http"),
      url: connectorUrlSchema,
    })
    .strict(),
  z
    .object({
      // the endpoints and client id the user named; absent, discovery finds them.
      authorizationEndpoint: connectorUrlSchema.optional(),
      clientId: z.string().min(1).optional(),
      // what discovery found: kept as soon as it runs while the row holds no grant, else
      // with the grant it authorized, so `tokens` are always refreshed with the client that got them.
      discovered: storedDiscoveredServerSchema.optional(),
      kind: z.literal("oauth"),
      // set when a refresh was refused; cleared by the next authorize.
      needsReauth: z.boolean().optional(),
      scopes: z.array(z.string().min(1)),
      tokenEndpoint: connectorUrlSchema.optional(),
      tokens: storedOauthTokensSchema.optional(),
      url: connectorUrlSchema,
    })
    .strict(),
]);
export type StoredTransport = z.infer<typeof storedTransportSchema>;
export type StoredOauthTransport = Extract<StoredTransport, { kind: "oauth" }>;

export interface OauthServer {
  authorizationEndpoint: string;
  clientId: string;
  tokenEndpoint: string;
}

// all three named, or discovery owns all of them: the contract refuses a half-named row.
export const namedOauthServerOf = (transport: StoredOauthTransport): OauthServer | null => {
  const { authorizationEndpoint, clientId, tokenEndpoint } = transport;
  return authorizationEndpoint === undefined ||
    clientId === undefined ||
    tokenEndpoint === undefined
    ? null
    : { authorizationEndpoint, clientId, tokenEndpoint };
};

// what the row authorizes and refreshes with: named, else what discovery found.
export const oauthServerOf = (transport: StoredOauthTransport): OauthServer | null => {
  const named = namedOauthServerOf(transport);
  if (named !== null) {
    return named;
  }
  const { discovered } = transport;
  const clientId = transport.clientId ?? discovered?.registration?.clientId;
  return discovered === undefined || clientId === undefined
    ? null
    : {
        authorizationEndpoint: discovered.authorizationEndpoint,
        clientId,
        tokenEndpoint: discovered.tokenEndpoint,
      };
};

const storedConnectorSchema = z
  .object({
    enabled: z.boolean(),
    name: connectorNameSchema,
    transport: storedTransportSchema,
  })
  .strict();
export type StoredConnector = z.infer<typeof storedConnectorSchema>;

const storeFileSchema = z.object({ servers: z.array(storedConnectorSchema) }).strict();

export class ConnectorsStore {
  private readonly file: JsonFileStore<typeof storeFileSchema>;

  constructor(dataDir: string) {
    this.file = new JsonFileStore({
      dataDir,
      empty: { servers: [] },
      fileName: CONNECTORS_FILE,
      // holds api keys
      mode: 0o600,
      schema: storeFileSchema,
    });
  }

  read(): StoredConnector[] {
    return this.file.read().servers;
  }

  write(servers: StoredConnector[]): void {
    this.file.write({ servers });
  }
}
