// `inteligir guide` — print the manual the RUNNING server serves, so the
// text an agent reads always matches the build it is driving.

import type { Command } from "commander";
import { apiFor, type CliDeps } from "../context";
import { outputJson, type JsonOutputOptions } from "../output";

export function registerGuideCommand(program: Command, deps: CliDeps): void {
  program
    .command("guide")
    .description("Print the agent manual served by the app")
    .option("--json", "Print machine-readable JSON output")
    .action(async (opts: JsonOutputOptions) => {
      const api = await apiFor(deps);
      const response = await api.guide.$get();
      const body = await response.json();
      if (outputJson(opts, body)) {
        return;
      }
      console.log(body.markdown);
    });
}
