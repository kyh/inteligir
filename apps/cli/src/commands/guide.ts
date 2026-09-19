import { defineCommand } from "citty";
import { apiFor } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, outputJson, writeOut } from "../output";

export const guideCommand = (deps: CliDeps) =>
  defineCommand({
    args: { ...jsonArg },
    meta: { description: "Print the agent manual served by the app", name: "guide" },
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
