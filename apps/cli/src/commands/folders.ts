import { defineCommand } from "citty";
import { apiFor, type CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines } from "../output";

export function foldersCommand(deps: CliDeps) {
  return defineCommand({
    meta: {
      name: "folders",
      description: "Folders the agent is pointed at as reference context",
    },
    subCommands: {
      list: defineCommand({
        meta: { name: "list", description: "List the connected folders" },
        args: { ...jsonArg },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.folders.list();
          if (outputJson(args, body)) {
            return;
          }
          if (body.folders.length === 0) {
            out.info("No folders are connected.");
            return;
          }
          writeLines(body.folders);
        },
      }),

      add: defineCommand({
        meta: { name: "add", description: "Connect a folder (absolute path)" },
        args: {
          path: { type: "positional", required: true, description: "Absolute directory path" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.folders.add({ path: args.path });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Connected ${args.path}; sessions see it from their next launch.`);
        },
      }),

      remove: defineCommand({
        meta: { name: "remove", description: "Disconnect a folder" },
        args: {
          path: { type: "positional", required: true, description: "The connected path" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.folders.remove({ path: args.path });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Disconnected ${args.path}.`);
        },
      }),
    },
  });
}
