import { defineCommand } from "citty";
import { apiFor, contextThreadId, type CliDeps } from "../context";
import { jsonArg, out, outputJson } from "../output";

export function statusCommand(deps: CliDeps) {
  return defineCommand({
    meta: {
      name: "status",
      description: "Server version, data dir, vault, agent runtime state, thread context",
    },
    args: { ...jsonArg },
    run: async ({ args }) => {
      const server = deps.resolveServer();
      const api = apiFor(deps);
      const body = await api.system.status();
      const threadId = contextThreadId(deps.env) ?? null;
      if (
        outputJson(args, {
          serverUrl: server.baseUrl,
          contextThreadId: threadId,
          ...body,
        })
      ) {
        return;
      }
      const agentDetail = body.agent.detail === null ? "" : ` — ${body.agent.detail}`;
      out.box(
        [
          `inteligir ${body.version} — ${server.baseUrl}`,
          `Data dir: ${body.dataDir}`,
          `Vault: ${body.vaultDir}`,
          `Schema: v${body.schemaVersion} — uptime ${Math.round(body.uptimeMs / 1_000)}s`,
          `Agent: ${body.agent.runtime} (mode ${body.agent.mode})${agentDetail}`,
          ...(threadId === null ? [] : [`Thread context: ${threadId}`]),
        ].join("\n"),
      );
    },
  });
}
