// `inteligir connectors` — the MCP servers codex will offer the agent.
//
// READ-ONLY, and that is the design rather than a gap. An MCP server is
// arbitrary code the agent then talks to, so adding one has to be a person's
// deliberate act with the command in front of them — which is what Settings →
// Connectors is. A CLI leaf for it would put "install a tool for yourself" in
// the same reach as `search`, in the one surface whose whole purpose is to be
// driven by a model. Listing is the half an agent has a real use for: knowing
// which tools it has.

import { connectorTarget } from "@repo/server-contract/connectors";
import { defineCommand } from "citty";
import { apiFor, type CliDeps } from "../context";
import { jsonArg, out, outputJson, requireOk, writeLines } from "../output";

export function connectorsCommand(deps: CliDeps) {
  return defineCommand({
    meta: {
      name: "connectors",
      description:
        "The MCP servers Codex is configured with (read-only; add and remove in the app)",
    },
    subCommands: {
      list: defineCommand({
        meta: { name: "list", description: "List the configured MCP servers" },
        args: { ...jsonArg },
        run: async ({ args }) => {
          const api = await apiFor(deps);
          const body = await (await requireOk(await api.connectors.$get())).json();
          if (outputJson(args, body)) {
            return;
          }
          if (body.state === "unavailable") {
            out.info(body.detail);
            return;
          }
          if (body.servers.length === 0) {
            out.info("No MCP servers are configured.");
            return;
          }
          writeLines(
            body.servers.map((server) => {
              const state = [server.enabled ? "enabled" : "disabled", server.authStatus]
                .filter((part) => part !== null)
                .join(" ");
              return `${server.name}  ${connectorTarget(server.transport)}  [${state}]`;
            }),
          );
        },
      }),
    },
  });
}
