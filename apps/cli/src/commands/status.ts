// `inteligir status` — the server's system status plus this invocation's
// context: which server was dialed, HOW it was chosen, and which vault that
// server is about to write into. The last two matter most on the
// explicit-trust path (INTELIGIR_SERVER_URL), where the CLI verifies no
// identity and the user owns the choice.

import { defineCommand } from "citty";
import { apiFor, contextThreadId, type CliDeps } from "../context";
import { jsonArg, out, outputJson, requireOk } from "../output";

export function statusCommand(deps: CliDeps) {
  return defineCommand({
    meta: {
      name: "status",
      description: "Server version, data dir, vault, agent runtime state, thread context",
    },
    args: { ...jsonArg },
    run: async ({ args }) => {
      const server = await deps.resolveServer();
      const api = await apiFor(deps);
      const body = await (await requireOk(await api.system.status.$get())).json();
      const threadId = contextThreadId(deps.env) ?? null;
      if (
        outputJson(args, {
          serverUrl: server.baseUrl,
          serverSource: server.source,
          contextThreadId: threadId,
          ...body,
        })
      ) {
        return;
      }
      const agentDetail = body.agent.detail === null ? "" : ` — ${body.agent.detail}`;
      // The one surface here that is a SUMMARY rather than a listing, which is
      // what consola's box is for. Every other command prints rows a pipeline
      // reads.
      out.box(
        [
          `inteligir ${body.version} — ${server.baseUrl} (${server.source})`,
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
