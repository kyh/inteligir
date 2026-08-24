// The registry's policy over the store (issue #591). Three decisions live
// here and nowhere else:
//
// - EVERY READ IS REDACTED. Header values reduce to `hasAuth`; the full rows
//   leave this module only through `enabledForSessions()`, whose one caller
//   is session launch's composition (session-servers.ts).
// - ADD REFUSES A NAME THAT EXISTS (409) and UPDATE/REMOVE/TOGGLE REFUSE ONE
//   THAT DOES NOT (404) — the same two guards the codex driver stated, now
//   genuinely this app's.
// - AN UPDATE THAT OMITS HEADERS KEEPS THE STORED ONES, so editing a URL
//   never forces re-pasting a key and no client round-trips a secret.

import type {
  ConnectorAddRequest,
  ConnectorTransportInput,
  ConnectorUpdateRequest,
  ConnectorView,
} from "@repo/api/local/connectors/connectors-schema";

import {
  type ConnectorsStore,
  type StoredConnector,
  type StoredTransport,
} from "./connectors-store";

/** A write refused because of what is (or is not) already configured. */
export class ConnectorConflictError extends Error {
  readonly kind: "already-exists" | "not-found";

  constructor(kind: "already-exists" | "not-found", message: string) {
    super(message);
    this.kind = kind;
  }
}

/** One MCP server as session launch consumes it — full headers, enabled only. */
interface SessionMcpServer {
  name: string;
  transport: StoredTransport;
}

export interface ConnectorsService {
  list(): ConnectorView[];
  add(request: ConnectorAddRequest): ConnectorView[];
  update(request: ConnectorUpdateRequest): ConnectorView[];
  remove(name: string): ConnectorView[];
  toggle(name: string, enabled: boolean): ConnectorView[];
  /** The UNREDACTED enabled rows, for composing a session's mcpServers. */
  enabledForSessions(): SessionMcpServer[];
}

function toView(row: StoredConnector): ConnectorView {
  if (row.transport.kind === "stdio") {
    return {
      enabled: row.enabled,
      name: row.name,
      transport: { args: row.transport.args, command: row.transport.command, kind: "stdio" },
    };
  }
  if (row.transport.kind === "oauth") {
    return {
      enabled: row.enabled,
      name: row.name,
      transport: {
        authorizationEndpoint: row.transport.authorizationEndpoint,
        clientId: row.transport.clientId,
        kind: "oauth",
        scopes: row.transport.scopes,
        status:
          row.transport.needsReauth === true
            ? "needs-reauth"
            : row.transport.tokens === undefined
              ? "needs-auth"
              : "connected",
        tokenEndpoint: row.transport.tokenEndpoint,
        url: row.transport.url,
      },
    };
  }
  return {
    enabled: row.enabled,
    name: row.name,
    transport: {
      hasAuth: Object.keys(row.transport.headers ?? {}).length > 0,
      kind: "http",
      url: row.transport.url,
    },
  };
}

function toStoredTransport(
  input: ConnectorTransportInput,
  previous: StoredTransport | undefined,
): StoredTransport {
  if (input.kind === "stdio") {
    return { args: input.args, command: input.command, kind: "stdio" };
  }
  if (input.kind === "oauth") {
    const next: StoredTransport = {
      authorizationEndpoint: input.authorizationEndpoint,
      clientId: input.clientId,
      kind: "oauth",
      scopes: input.scopes,
      tokenEndpoint: input.tokenEndpoint,
      url: input.url,
    };
    // An endpoint edit keeps the stored tokens (no client round-trips a
    // secret, and no edit forces a re-consent) — if the edit made them wrong,
    // the next refresh fails into needs-reauth rather than guessing here.
    if (previous !== undefined && previous.kind === "oauth") {
      if (previous.tokens !== undefined) {
        next.tokens = previous.tokens;
      }
      if (previous.needsReauth === true) {
        next.needsReauth = true;
      }
    }
    return next;
  }
  const kept =
    input.headers ??
    (previous !== undefined && previous.kind === "http" ? previous.headers : undefined);
  const next: StoredTransport = { kind: "http", url: input.url };
  if (kept !== undefined && Object.keys(kept).length > 0) {
    next.headers = kept;
  }
  return next;
}

export function createConnectorsService(store: ConnectorsStore): ConnectorsService {
  const requireRow = (servers: StoredConnector[], name: string): StoredConnector => {
    const row = servers.find((candidate) => candidate.name === name);
    if (row === undefined) {
      throw new ConnectorConflictError("not-found", `No connector named "${name}" is configured`);
    }
    return row;
  };

  return {
    list(): ConnectorView[] {
      return store.read().map(toView);
    },

    add(request: ConnectorAddRequest): ConnectorView[] {
      const servers = store.read();
      if (servers.some((row) => row.name === request.name)) {
        throw new ConnectorConflictError(
          "already-exists",
          `A connector named "${request.name}" already exists — remove it first, or pick another name`,
        );
      }
      servers.push({
        enabled: true,
        name: request.name,
        transport: toStoredTransport(request.transport, undefined),
      });
      store.write(servers);
      return servers.map(toView);
    },

    update(request: ConnectorUpdateRequest): ConnectorView[] {
      const servers = store.read();
      const row = requireRow(servers, request.name);
      row.transport = toStoredTransport(request.transport, row.transport);
      store.write(servers);
      return servers.map(toView);
    },

    remove(name: string): ConnectorView[] {
      const servers = store.read();
      requireRow(servers, name);
      const remaining = servers.filter((row) => row.name !== name);
      store.write(remaining);
      return remaining.map(toView);
    },

    toggle(name: string, enabled: boolean): ConnectorView[] {
      const servers = store.read();
      requireRow(servers, name).enabled = enabled;
      store.write(servers);
      return servers.map(toView);
    },

    enabledForSessions(): SessionMcpServer[] {
      return store
        .read()
        .filter((row) => row.enabled)
        .map((row) => ({ name: row.name, transport: row.transport }));
    },
  };
}
