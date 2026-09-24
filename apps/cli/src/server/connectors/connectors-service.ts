import type {
  ConnectorAddRequest,
  ConnectorTransportInput,
  ConnectorView,
} from "@repo/api/local/connectors/connectors-schema";

import { oauthServerOf } from "./connectors-store";
import type {
  ConnectorsStore,
  StoredConnector,
  StoredOauthTransport,
  StoredTransport,
} from "./connectors-store";

export class ConnectorConflictError extends Error {
  readonly kind: "already-exists" | "not-found";

  constructor(kind: "already-exists" | "not-found", message: string) {
    super(message);
    this.name = "ConnectorConflictError";
    this.kind = kind;
  }
}

interface SessionMcpServer {
  name: string;
  transport: StoredTransport;
}

export interface ConnectorsService {
  list: () => ConnectorView[];
  add: (request: ConnectorAddRequest) => ConnectorView[];
  remove: (name: string) => ConnectorView[];
  toggle: (name: string, enabled: boolean) => ConnectorView[];
  enabledForSessions: () => SessionMcpServer[];
}

const oauthStatus = (
  transport: StoredOauthTransport,
): "needs-reauth" | "needs-auth" | "connected" => {
  if (transport.needsReauth === true) {
    return "needs-reauth";
  }
  return transport.tokens === undefined ? "needs-auth" : "connected";
};

const toView = (row: StoredConnector): ConnectorView => {
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
        ...oauthServerOf(row.transport),
        kind: "oauth",
        scopes: row.transport.scopes,
        status: oauthStatus(row.transport),
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
};

const toStoredTransport = (input: ConnectorTransportInput): StoredTransport => {
  if (input.kind === "stdio") {
    return { args: input.args, command: input.command, kind: "stdio" };
  }
  if (input.kind === "oauth") {
    const oauth: StoredOauthTransport = { kind: "oauth", scopes: input.scopes, url: input.url };
    if (input.authorizationEndpoint !== undefined) {
      oauth.authorizationEndpoint = input.authorizationEndpoint;
    }
    if (input.tokenEndpoint !== undefined) {
      oauth.tokenEndpoint = input.tokenEndpoint;
    }
    if (input.clientId !== undefined) {
      oauth.clientId = input.clientId;
    }
    return oauth;
  }
  const next: StoredTransport = { kind: "http", url: input.url };
  if (input.headers !== undefined && Object.keys(input.headers).length > 0) {
    next.headers = input.headers;
  }
  return next;
};

const requireRow = (servers: StoredConnector[], name: string): StoredConnector => {
  const row = servers.find((candidate) => candidate.name === name);
  if (row === undefined) {
    throw new ConnectorConflictError("not-found", `No connector named "${name}" is configured`);
  }
  return row;
};

export const createConnectorsService = (store: ConnectorsStore): ConnectorsService => ({
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
      transport: toStoredTransport(request.transport),
    });
    store.write(servers);
    return servers.map(toView);
  },

  enabledForSessions(): SessionMcpServer[] {
    return store
      .read()
      .filter((row) => row.enabled)
      .map((row) => ({ name: row.name, transport: row.transport }));
  },

  list(): ConnectorView[] {
    return store.read().map(toView);
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
});
