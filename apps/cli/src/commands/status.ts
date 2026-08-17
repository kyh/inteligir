// `inteligir status` — the server's system status plus this invocation's
// context: which server was dialed, HOW it was chosen, and which vault that
// server is about to write into. The last two matter most on the
// explicit-trust path (INTELIGIR_SERVER_URL), where the CLI verifies no
// identity and the user owns the choice.

import type { Command } from "commander";
import { apiFor, contextThreadId, type CliDeps } from "../context";
import { outputJson, requireOk, type JsonOutputOptions } from "../output";

export function registerStatusCommand(program: Command, deps: CliDeps): void {
  program
    .command("status")
    .description("Server version, data dir, vault, agent runtime state, thread context")
    .option("--json", "Print machine-readable JSON output")
    .action(async (opts: JsonOutputOptions) => {
      const server = await deps.resolveServer();
      const api = await apiFor(deps);
      const body = await (await requireOk(await api.system.status.$get())).json();
      const threadId = contextThreadId(deps.env) ?? null;
      if (
        outputJson(opts, {
          serverUrl: server.baseUrl,
          serverSource: server.source,
          contextThreadId: threadId,
          ...body,
        })
      ) {
        return;
      }
      console.log(`inteligir ${body.version} — ${server.baseUrl} (${server.source})`);
      console.log(`Data dir: ${body.dataDir}`);
      console.log(`Vault: ${body.vaultDir}`);
      console.log(`Schema: v${body.schemaVersion} — uptime ${Math.round(body.uptimeMs / 1_000)}s`);
      const agentDetail = body.agent.detail === null ? "" : ` — ${body.agent.detail}`;
      console.log(`Agent: ${body.agent.runtime} (mode ${body.agent.mode})${agentDetail}`);
      if (threadId !== null) {
        console.log(`Thread context: ${threadId}`);
      }
    });
}
