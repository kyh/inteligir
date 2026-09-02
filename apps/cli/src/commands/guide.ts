import { defineCommand } from "citty";
import { apiFor, type CliDeps } from "../context";
import { jsonArg, outputJson, writeOut } from "../output";

export function guideCommand(deps: CliDeps) {
  return defineCommand({
    meta: { name: "guide", description: "Print the agent manual served by the app" },
    args: { ...jsonArg },
    run: async ({ args }) => {
      const api = apiFor(deps);
      const body = await api.system.guide();
      if (outputJson(args, body)) {
        return;
      }
      // raw, not consola: its reporter rewrites every `backtick` span.
      writeOut(`${body.markdown}\n`);
    },
  });
}
