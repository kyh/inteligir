// The registry rows → ACP mcpServers composition every session boots
// through. Lives beside the service so serve.ts passes only a thunk — the
// thunk must stay LAZY (called per session open), which is what lets a
// Settings edit reach the next session without a reboot.

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
      // A row that cannot present a live token is EXCLUDED, not injected
      // to 401 on every call — Settings shows needs-reauth in its place.
      // Sequential on purpose: freshAccessToken writes needs-reauth into the
      // shared store, and parallel refreshes would interleave those writes.
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
