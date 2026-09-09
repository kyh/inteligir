import { defineCommand } from "citty";
import { apiFor, contextThreadId } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, out, outputJson } from "../output";

export const statusCommand = (deps: CliDeps) =>
  defineCommand({
    args: { ...jsonArg },
    meta: {
      description: "Server version, data dir, vault, agent runtime state, thread context",
      name: "status",
    },
    run: async ({ args }) => {
      const server = deps.resolveServer();
      const api = apiFor(deps);
      const body = await api.system.status();
      const threadId = contextThreadId(deps.env) ?? null;
      if (
        outputJson(args, {
          contextThreadId: threadId,
          serverUrl: server.baseUrl,
          ...body,
        })
      ) {
        return;
      }
      const agentDetail = body.agent.detail === null ? "" : ` — ${body.agent.detail}`;
      out.box(
        [
          `inteligir ${body.version} — ${server.baseUrl}`,
          `Data dir: ${body.dataDir}${body.dataDirScope === "vault" ? " (this vault's own)" : ""}`,
          `Vault: ${body.vaultDir}`,
          `Schema: v${body.schemaVersion} — uptime ${Math.round(body.uptimeMs / 1000)}s`,
          `Agent: ${body.agent.runtime} (mode ${body.agent.mode})${agentDetail}`,
          ...(threadId === null ? [] : [`Thread context: ${threadId}`]),
        ].join("\n"),
      );
    },
  });
