import { defineCommand } from "citty";
import { apiFor } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines } from "../output";

export const agentsCommand = (deps: CliDeps) =>
  defineCommand({
    meta: {
      description: "The agent harnesses on this machine, and which one a new action starts on",
      name: "agents",
    },
    subCommands: {
      default: defineCommand({
        args: {
          id: {
            description: "A harness id from `agents list`",
            required: true,
            type: "positional",
          },
          ...jsonArg,
        },
        meta: { description: "Choose the harness a new action starts on", name: "default" },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.agents.setDefault({ id: args.id });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`New actions start on ${body.defaultId}; a running action keeps its own.`);
        },
      }),

      list: defineCommand({
        args: { ...jsonArg },
        meta: { description: "Each harness: CLI found, signed in, and the default", name: "list" },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.agents.status();
          if (outputJson(args, body)) {
            return;
          }
          writeLines(
            body.harnesses.map((probe) => {
              let state = "sign-in state unknown";
              if (probe.cliPath === null) {
                state = "not installed";
              } else if (probe.credentials === "present") {
                state = "ready";
              } else if (probe.credentials === "absent") {
                state = `needs sign-in (${probe.loginCommand})`;
              }
              const marker = probe.id === body.defaultId ? " (default)" : "";
              return `${probe.id}${marker} — ${state}`;
            }),
          );
        },
      }),
    },
  });
