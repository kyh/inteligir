import { defineCommand } from "citty";
import { apiFor, type CliDeps } from "../context";
import { jsonArg, out, outputJson } from "../output";

export function tagCommand(deps: CliDeps) {
  return defineCommand({
    meta: { name: "tag", description: "One tag, across every note" },
    subCommands: {
      rename: defineCommand({
        meta: {
          name: "rename",
          description: "Rename a tag, and the tags nested under it, in every note that holds it",
        },
        args: {
          from: { type: "positional", required: true, description: "The tag, without the #" },
          to: { type: "positional", required: true, description: "The new name, without the #" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.knowledge.renameTag({ from: args.from, to: args.to });
          if (outputJson(args, body)) {
            return;
          }
          const count = body.rewritten.length;
          out.success(
            `Renamed #${body.from} to #${body.to} in ${count} note${count === 1 ? "" : "s"}.`,
          );
          for (const skip of body.skipped) {
            out.warn(`Skipped ${skip.path}: ${skip.reason}`);
          }
        },
      }),
    },
  });
}
