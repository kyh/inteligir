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
    refreshToken: z.string().min(1).optional(),
    expiresAt: z.number().int().nullable(),
  })
  .strict();
export type StoredOauthTokens = z.infer<typeof storedOauthTokensSchema>;

const storedTransportSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("stdio"),
      command: z.string().min(1),
      args: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      kind: z.literal("http"),
      url: connectorUrlSchema,
      headers: z.record(z.string().min(1), z.string().min(1)).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("oauth"),
      url: connectorUrlSchema,
      authorizationEndpoint: connectorUrlSchema,
      tokenEndpoint: connectorUrlSchema,
      clientId: z.string().min(1),
      scopes: z.array(z.string().min(1)),
      tokens: storedOauthTokensSchema.optional(),
      // set when a refresh was refused; cleared by the next authorize.
      needsReauth: z.boolean().optional(),
    })
    .strict(),
]);
export type StoredTransport = z.infer<typeof storedTransportSchema>;

const storedConnectorSchema = z
  .object({
    name: connectorNameSchema,
    enabled: z.boolean(),
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
      fileName: CONNECTORS_FILE,
      schema: storeFileSchema,
      empty: { servers: [] },
      // holds api keys
      mode: 0o600,
    });
  }

  read(): StoredConnector[] {
    return this.file.read().servers;
  }

  write(servers: StoredConnector[]): void {
    this.file.write({ servers });
  }
}
