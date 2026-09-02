import {
  connectorTarget,
  type ConnectorsResponse,
  type ConnectorTransportInput,
} from "@repo/api/local/connectors/connectors-schema";
import { defineCommand } from "citty";
import { invalidUsage } from "../cli-error";
import { apiFor, type CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines } from "../output";

// an empty array (a bare trailing `--`) is not null: the caller meant stdio and named no program.
function commandAfterDoubleDash(rawArgs: readonly string[]): string[] | null {
  const index = rawArgs.indexOf("--");
  return index === -1 ? null : rawArgs.slice(index + 1);
}

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
          const body: ConnectorsResponse = await api.connectors.list();
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
          description: "Add an MCP server (--url for http, or -- <command> [args…] for stdio)",
        },
        args: {
          name: { type: "positional", required: true, description: "Registry name" },
          url: { type: "string", description: "The server's http(s) URL" },
          header: {
            type: "string",
            description: "Auth header as NAME=VALUE (http only)",
          },
          ...jsonArg,
        },
        // stdio args ride after `--`, not repeated `--arg` flags: citty's parseArgs has no `multiple`,
        // so repeats keep only the last value and a token like `-y` vanishes.
        run: async ({ args, rawArgs }) => {
          const stdioCommand = commandAfterDoubleDash(rawArgs);
          if ((args.url === undefined) === (stdioCommand === null)) {
            throw invalidUsage("provide exactly one of --url or -- <command> [args…]");
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
          } else if (stdioCommand !== null) {
            const [program, ...rest] = stdioCommand;
            if (program === undefined) {
              throw invalidUsage("-- must be followed by a command to run");
            }
            transport = { args: rest, command: program, kind: "stdio" };
          } else {
            throw invalidUsage("provide exactly one of --url or -- <command> [args…]");
          }
          const api = apiFor(deps);
          const body = await api.connectors.add({ name: args.name, transport });
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
          const body = await api.connectors.remove({ name: args.name });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Removed ${args.name}.`);
        },
      }),
    },
  });
}
