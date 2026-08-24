// The registry's bytes: `<dataDir>/connectors.json`, parsed at the boundary
// and written atomically at 0600 — it can carry API keys, so it lives beside
// `server.json` under the same file-mode discipline, and NOT in the vault
// (a git repo pushed to a remote the user chose) or the thread db (synced).
//
// A JSON file rather than a db table on purpose: connectors are a handful of
// rows a person edits, the whole value is read on every session launch, and
// the db's migration machinery would be weight with no query to earn it.

import { readFileSync } from "node:fs";
import { stagedWriteFileSync } from "../staged-write";
import { join } from "node:path";
import { z } from "zod";

import {
  connectorNameSchema,
  connectorUrlSchema,
} from "@repo/api/local/connectors/connectors-schema";

const CONNECTORS_FILE = "connectors.json";

/** Tokens live ON the row rather than in a second file: two files that must
 *  agree are two files that can disagree, and this one already carries header
 *  secrets under the same 0600 discipline. `expiresAt` is epoch seconds, null
 *  when the provider named no lifetime. */
const storedOauthTokensSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1).optional(),
    expiresAt: z.number().int().nullable(),
  })
  .strict();
export type StoredOauthTokens = z.infer<typeof storedOauthTokensSchema>;

/** The stored row: the INPUT transport shape, headers included verbatim. */
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
      /** Set when a refresh was refused; cleared by the next authorize. */
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

export interface ConnectorsStore {
  read(): StoredConnector[];
  write(servers: StoredConnector[]): void;
}

/**
 * Reads surface a MALFORMED file as an error rather than an empty list — an
 * empty list is a claim there are no connectors, and the next write would
 * then erase whatever the unparseable bytes held. A MISSING file is genuinely
 * empty.
 */
export function createConnectorsStore(dataDir: string): ConnectorsStore {
  const path = join(dataDir, CONNECTORS_FILE);
  return {
    read(): StoredConnector[] {
      let raw: string;
      try {
        raw = readFileSync(path, "utf8");
      } catch {
        return [];
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new ConnectorsStoreError(
          `${path} is not valid JSON — fix or remove the file; refusing to read it as empty`,
        );
      }
      const verdict = storeFileSchema.safeParse(parsed);
      if (!verdict.success) {
        throw new ConnectorsStoreError(
          `${path} does not match the connectors shape — fix or remove the file; refusing to read it as empty`,
        );
      }
      return verdict.data.servers;
    },

    write(servers: StoredConnector[]): void {
      stagedWriteFileSync(path, `${JSON.stringify({ servers }, null, 2)}\n`, { mode: 0o600 });
    },
  };
}
