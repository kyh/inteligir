// carries api keys, so it sits beside server.json at 0600 and not in the vault (pushed) or the
// thread db (synced). a json file, not a db table: a handful of rows read whole per session
// launch, with no query to earn migrations.

import { readFileSync } from "node:fs";
import { stagedWriteFileSync } from "../staged-write";
import { join } from "node:path";
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

export class ConnectorsStoreError extends Error {}

// a malformed file is an error, not an empty list: an empty list lets the next write erase what the bytes held.
export class ConnectorsStore {
  private readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, CONNECTORS_FILE);
  }

  read(): StoredConnector[] {
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch {
      return [];
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ConnectorsStoreError(
        `${this.path} is not valid JSON — fix or remove the file; refusing to read it as empty`,
      );
    }
    const verdict = storeFileSchema.safeParse(parsed);
    if (!verdict.success) {
      throw new ConnectorsStoreError(
        `${this.path} does not match the connectors shape — fix or remove the file; refusing to read it as empty`,
      );
    }
    return verdict.data.servers;
  }

  write(servers: StoredConnector[]): void {
    stagedWriteFileSync(this.path, `${JSON.stringify({ servers }, null, 2)}\n`, { mode: 0o600 });
  }
}
