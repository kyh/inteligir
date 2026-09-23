import { connectorTarget } from "@repo/api/local/connectors/connectors-schema";
import type {
  ConnectorsResponse,
  ConnectorTransportInput,
  ConnectorTransportView,
} from "@repo/api/local/connectors/connectors-schema";
import { defineCommand } from "citty";
import { invalidUsage } from "../cli-error";
import { apiFor } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines } from "../output";
import { readSecretFromStdin } from "./password-prompt";

// an empty array (a bare trailing `--`) is not null: the caller meant stdio and named no program.
const commandAfterDoubleDash = (rawArgs: readonly string[]): string[] | null => {
  const index = rawArgs.indexOf("--");
  return index === -1 ? null : rawArgs.slice(index + 1);
};

// `NAME=-` keeps the key off argv, which a process listing and the shell's history both show.
type HeaderArg = { kind: "argv"; name: string; value: string } | { kind: "stdin"; name: string };

const parseHeaderArg = (raw: string): HeaderArg => {
  const eq = raw.indexOf("=");
  if (eq <= 0) {
    throw invalidUsage("--header takes NAME=VALUE, or NAME=- to read the value from stdin");
  }
  const name = raw.slice(0, eq);
  const value = raw.slice(eq + 1);
  return value === "-" ? { kind: "stdin", name } : { kind: "argv", name, value };
};

const authLabel = (transport: ConnectorTransportView): string => {
  switch (transport.kind) {
    case "http": {
      return transport.hasAuth ? " authenticated" : "";
    }
    case "oauth": {
      return ` ${transport.status}`;
    }
    case "stdio": {
      return "";
    }
    // no default
  }
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
            description: "Auth header as NAME=VALUE (http only); NAME=- reads the value from stdin",
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
          let header: HeaderArg | null = null;
          if (args.url !== undefined) {
            transport = { kind: "http", url: args.url };
            header = args.header === undefined ? null : parseHeaderArg(args.header);
          } else if (stdioCommand === null) {
            throw invalidUsage("provide exactly one of --url or -- <command> [args…]");
          } else if (args.header === undefined) {
            const [program, ...rest] = stdioCommand;
            if (program === undefined) {
              throw invalidUsage("-- must be followed by a command to run");
            }
            transport = { args: rest, command: program, kind: "stdio" };
          } else {
            throw invalidUsage("--header is for a --url server; a stdio server sends no headers");
          }
          const api = apiFor(deps);
          // read once a server is resolved: a key piped in for a server that is not there is spent for nothing.
          if (header !== null && transport.kind === "http") {
            transport.headers = {
              [header.name]:
                header.kind === "stdin" ? await readSecretFromStdin("header value") : header.value,
            };
          }
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
            body.servers.map(
              (server) =>
                `${server.name}  ${connectorTarget(server.transport)}  [${server.enabled ? "enabled" : "disabled"}${authLabel(server.transport)}]`,
            ),
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
