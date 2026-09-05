import { defineCommand } from "citty";
import { apiFor, type CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines } from "../output";

export function agentsCommand(deps: CliDeps) {
  return defineCommand({
    meta: {
      name: "agents",
      description: "The agent harnesses on this machine, and which one a new action starts on",
    },
    subCommands: {
      list: defineCommand({
        meta: { name: "list", description: "Each harness: CLI found, signed in, and the default" },
        args: { ...jsonArg },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.agents.status();
          if (outputJson(args, body)) {
            return;
          }
          writeLines(
            body.harnesses.map((probe) => {
              const state =
                probe.cliPath === null
                  ? "not installed"
                  : probe.credentials === "present"
                    ? "ready"
                    : probe.credentials === "absent"
                      ? `needs sign-in (${probe.loginCommand})`
                      : "sign-in state unknown";
              const marker = probe.id === body.defaultId ? " (default)" : "";
              return `${probe.id}${marker} — ${state}`;
            }),
          );
        },
      }),

      default: defineCommand({
        meta: { name: "default", description: "Choose the harness a new action starts on" },
        args: {
          id: {
            type: "positional",
            required: true,
            description: "A harness id from `agents list`",
          },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.agents.setDefault({ id: args.id });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`New actions start on ${body.defaultId}; a running action keeps its own.`);
        },
      }),
    },
  });
}
