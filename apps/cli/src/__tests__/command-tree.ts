// Shared by the two surface fitness tests (--json enforcement, guide
// coverage): the real program object and a walk of its leaf commands.

import type { Command } from "commander";
import type { CliDeps } from "../context";
import { buildProgram } from "../program";

export function testProgram(): Command {
  const deps: CliDeps = {
    env: {},
    resolveServer: async () => "http://127.0.0.1:0",
  };
  return buildProgram(deps);
}

export function collectLeafCommands(
  command: Command,
  prefix = "",
): Array<{ path: string; cmd: Command }> {
  const results: Array<{ path: string; cmd: Command }> = [];
  for (const sub of command.commands) {
    const fullPath = prefix.length > 0 ? `${prefix} ${sub.name()}` : sub.name();
    if (sub.commands.length === 0) {
      results.push({ path: fullPath, cmd: sub });
    } else {
      results.push(...collectLeafCommands(sub, fullPath));
    }
  }
  return results;
}
