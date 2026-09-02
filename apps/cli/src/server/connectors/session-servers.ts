// the caller's thunk must stay lazy (called per session open), so a settings edit
// reaches the next session without a reboot.

import type { AcpMcpServerConfig } from "@repo/agent-runtime/acp/acp-runtime";
import type { ConnectorsService } from "./connectors-service";
import type { ConnectorOauthFlow } from "./oauth-flow";

export async function composeSessionMcpServers(
  connectors: Pick<ConnectorsService, "enabledForSessions">,
  oauth: Pick<ConnectorOauthFlow, "freshAccessToken">,
): Promise<AcpMcpServerConfig[]> {
  const servers: AcpMcpServerConfig[] = [];
  for (const row of connectors.enabledForSessions()) {
    if (row.transport.kind === "stdio") {
      servers.push({
        args: row.transport.args,
        command: row.transport.command,
        kind: "stdio",
        name: row.name,
      });
      continue;
    }
    if (row.transport.kind === "oauth") {
      // a row without a live token is excluded rather than injected to 401 on every call.
      // sequential: freshAccessToken writes needs-reauth into the shared store.
      const accessToken = await oauth.freshAccessToken(row.name);
      if (accessToken !== null) {
        servers.push({
          headers: { Authorization: `Bearer ${accessToken}` },
          kind: "http",
          name: row.name,
          url: row.transport.url,
        });
      }
      continue;
    }
    const server: AcpMcpServerConfig = {
      kind: "http",
      name: row.name,
      url: row.transport.url,
    };
    if (row.transport.headers !== undefined) {
      server.headers = row.transport.headers;
    }
    servers.push(server);
  }
  return servers;
}
