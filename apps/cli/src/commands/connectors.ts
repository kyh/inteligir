import { connectorTarget } from "@repo/api/local/connectors/connectors-schema";
import type {
  ConnectorsResponse,
  ConnectorTransportInput,
} from "@repo/api/local/connectors/connectors-schema";
import { defineCommand } from "citty";
import { invalidUsage } from "../cli-error";
import { apiFor } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines } from "../output";

// an empty array (a bare trailing `--`) is not null: the caller meant stdio and named no program.
const commandAfterDoubleDash = (rawArgs: readonly string[]): string[] | null => {
  const index = rawArgs.indexOf("--");
  return index === -1 ? null : rawArgs.slice(index + 1);
};

export const connectorsCommand = (deps: CliDeps) =>
  defineCommand({
    meta: {
      description: "The MCP servers every agent session gets",
      name: "connectors",
    },
    subCommands: {
      add: defineCommand({
        args: {
          header: {
            description: "Auth header as NAME=VALUE (http only)",
            type: "string",
          },
          name: { description: "Registry name", required: true, type: "positional" },
          url: { description: "The server's http(s) URL", type: "string" },
          ...jsonArg,
        },
        meta: {
          description: "Add an MCP server (--url for http, or -- <command> [args…] for stdio)",
          name: "add",
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
          } else if (stdioCommand === null) {
            throw invalidUsage("provide exactly one of --url or -- <command> [args…]");
          } else {
            const [program, ...rest] = stdioCommand;
            if (program === undefined) {
              throw invalidUsage("-- must be followed by a command to run");
            }
            transport = { args: rest, command: program, kind: "stdio" };
          }
          const api = apiFor(deps);
          const body = await api.connectors.add({ name: args.name, transport });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Added ${args.name}; sessions get it from their next launch.`);
        },
      }),

      list: defineCommand({
        args: { ...jsonArg },
        meta: { description: "List the configured MCP servers", name: "list" },
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

      remove: defineCommand({
        args: {
          name: { description: "Registry name", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: { description: "Remove an MCP server from the registry", name: "remove" },
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
