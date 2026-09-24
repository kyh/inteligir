import { defineCommand } from "citty";
import { harnessReadiness } from "@repo/api/local/agents/agents-schema";
import type { HarnessProbe } from "@repo/api/local/agents/agents-schema";
import { apiFor } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines } from "../output";

const readinessLine = (probe: HarnessProbe): string => {
  switch (harnessReadiness(probe)) {
    case "not-installed": {
      return "not installed";
    }
    case "ready": {
      return "ready";
    }
    case "needs-sign-in": {
      return `needs sign-in (${probe.loginCommand})`;
    }
    case "unknown": {
      return "sign-in state unknown";
    }
    // no default
  }
};

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
              const marker = probe.id === body.defaultId ? " (default)" : "";
              return `${probe.id}${marker} — ${readinessLine(probe)}`;
            }),
          );
        },
      }),
    },
  });
