// `inteligir guide` — print the manual the RUNNING server serves, so the
// text an agent reads always matches the build it is driving.

import { defineCommand } from "citty";
import { apiFor, type CliDeps } from "../context";
import { jsonArg, outputJson, requireOk, writeOut } from "../output";

export function guideCommand(deps: CliDeps) {
  return defineCommand({
    meta: { name: "guide", description: "Print the agent manual served by the app" },
    args: { ...jsonArg },
    run: async ({ args }) => {
      const api = await apiFor(deps);
      const body = await (await requireOk(await api.guide.$get())).json();
      if (outputJson(args, body)) {
        return;
      }
      // Raw, not consola: the manual is markdown, and consola's reporter
      // rewrites every `backtick` span in a message it formats.
      writeOut(`${body.markdown}\n`);
    },
  });
}
