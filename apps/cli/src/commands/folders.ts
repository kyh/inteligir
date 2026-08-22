// `inteligir folders` — Connected Folders (issue #601): the directories agent
// sessions are told about as read-only reference context. Parity verbs for
// what Settings → Connected folders does; not a permission surface — the
// rows only name what the user offers as reference.

import { defineCommand } from "citty";
import { apiFor, type CliDeps } from "../context";
import { jsonArg, out, outputJson, requireOk, writeLines } from "../output";

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
          const api = await apiFor(deps);
          const body = await (await requireOk(await api.folders.$get())).json();
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
          const api = await apiFor(deps);
          const response = await requireOk(
            await api.folders.add.$post({ json: { path: args.path } }),
          );
          const body = await response.json();
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
          const api = await apiFor(deps);
          const response = await requireOk(
            await api.folders.remove.$post({ json: { path: args.path } }),
          );
          const body = await response.json();
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Disconnected ${args.path}.`);
        },
      }),
    },
  });
}
