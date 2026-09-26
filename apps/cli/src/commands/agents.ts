import { defineCommand } from "citty";
import type { HarnessStatus } from "@repo/api/local/agents/agents-schema";
import { apiFor } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines } from "../output";

const statusLine = (status: HarnessStatus): string => {
  if (status.runtime === "missing") {
    return "runtime missing";
  }
  const { account } = status;
  switch (account.state) {
    case "signed-in": {
      return `signed in (${account.email === null ? account.label : `${account.label}, ${account.email}`})`;
    }
    case "signed-out": {
      return "signed out";
    }
    case "unknown": {
      return `sign-in state unknown (${account.detail})`;
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
        meta: {
          description: "Each harness: its runtime, its vendor's sign-in, and the default",
          name: "list",
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.agents.status();
          if (outputJson(args, body)) {
            return;
          }
          writeLines(
            body.harnesses.map((status) => {
              const marker = status.id === body.defaultId ? " (default)" : "";
              return `${status.id}${marker} — ${statusLine(status)}`;
            }),
          );
        },
      }),
    },
  });
