// `inteligir guide` — print the manual the RUNNING server serves, so the
// text an agent reads always matches the build it is driving.

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
      // Raw, not consola: the manual is markdown, and consola's reporter
      // rewrites every `backtick` span in a message it formats.
      writeOut(`${body.markdown}\n`);
    },
  });
}
