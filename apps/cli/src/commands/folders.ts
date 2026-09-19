import { defineCommand } from "citty";
import { apiFor } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines } from "../output";

export const foldersCommand = (deps: CliDeps) =>
  defineCommand({
    meta: {
      description: "Folders the agent is pointed at as reference context",
      name: "folders",
    },
    subCommands: {
      add: defineCommand({
        args: {
          path: { description: "Absolute directory path", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: { description: "Connect a folder (absolute path)", name: "add" },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.folders.add({ path: args.path });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Connected ${args.path}; sessions see it from their next launch.`);
        },
      }),

      list: defineCommand({
        args: { ...jsonArg },
        meta: { description: "List the connected folders", name: "list" },
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

      remove: defineCommand({
        args: {
          path: { description: "The connected path", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: { description: "Disconnect a folder", name: "remove" },
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
