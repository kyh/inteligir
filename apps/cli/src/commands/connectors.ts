// `inteligir connectors` — the app-owned MCP registry every agent session
// gets (issue #591). List, add and remove, under the parity principle:
// everything a user can do in Settings → Connectors, the agent can do here.
// The old list-only rule was reasoned from codex owning the store; the store
// is this app's now, so a CLI write races nothing and hides nothing —
// Settings shows the same rows the moment they change.

import { connectorTarget, type ConnectorTransportInput } from "@repo/server-contract/connectors";
import { defineCommand } from "citty";
import { invalidUsage } from "../cli-error";
import { apiFor, type CliDeps } from "../context";
import { jsonArg, out, outputJson, requireOk, writeLines } from "../output";

export function connectorsCommand(deps: CliDeps) {
  return defineCommand({
    meta: {
      name: "connectors",
      description: "The MCP servers every agent session gets",
    },
    subCommands: {
      list: defineCommand({
        meta: { name: "list", description: "List the configured MCP servers" },
        args: { ...jsonArg },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await (await requireOk(await api.connectors.$get())).json();
          if (outputJson(args, body)) {
            return;
          }
          if (body.servers.length === 0) {
            out.info("No MCP servers are configured.");
            return;
          }
          writeLines(
            body.servers.map((server) => {
              const auth =
                server.transport.kind === "http" && server.transport.hasAuth
                  ? " authenticated"
                  : "";
              return `${server.name}  ${connectorTarget(server.transport)}  [${server.enabled ? "enabled" : "disabled"}${auth}]`;
            }),
          );
        },
      }),

      add: defineCommand({
        meta: {
          name: "add",
          description: "Add an MCP server (http URL, or a command after --)",
        },
        args: {
          name: { type: "positional", required: true, description: "Registry name" },
          url: { type: "string", description: "The server's http(s) URL" },
          header: {
            type: "string",
            description: "Auth header as NAME=VALUE (http only)",
          },
          command: {
            type: "string",
            description: "Program to run for a stdio server",
          },
          arg: {
            type: "string",
            description: "One argument for --command (repeatable)",
          },
          ...jsonArg,
        },
        run: async ({ args }) => {
          if ((args.url === undefined) === (args.command === undefined)) {
            throw invalidUsage("provide exactly one of --url or --command");
          }
          let transport: ConnectorTransportInput;
          if (args.url !== undefined) {
            transport = { kind: "http", url: args.url };
            if (args.header !== undefined) {
              const eq = args.header.indexOf("=");
              if (eq <= 0) {
                throw invalidUsage("--header takes NAME=VALUE");
              }
              transport.headers = { [args.header.slice(0, eq)]: args.header.slice(eq + 1) };
            }
          } else if (args.command !== undefined) {
            const extra = args.arg;
            transport = {
              args: extra === undefined ? [] : Array.isArray(extra) ? extra : [extra],
              command: args.command,
              kind: "stdio",
            };
          } else {
            throw invalidUsage("provide exactly one of --url or --command");
          }
          const api = apiFor(deps);
          const response = await requireOk(
            await api.connectors.add.$post({ json: { name: args.name, transport } }),
          );
          const body = await response.json();
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Added ${args.name}; sessions get it from their next launch.`);
        },
      }),

      remove: defineCommand({
        meta: { name: "remove", description: "Remove an MCP server from the registry" },
        args: {
          name: { type: "positional", required: true, description: "Registry name" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const response = await requireOk(
            await api.connectors.remove.$post({ json: { name: args.name } }),
          );
          const body = await response.json();
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Removed ${args.name}.`);
        },
      }),
    },
  });
}
