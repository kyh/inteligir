// no `unpair` here on purpose: it discards a queue of unsent writes, a decision for a person in front of
// that state rather than a verb for a model to drive.

import type {
  CloudPairBeginRequest,
  CloudPairBeginResponse,
  CloudStatusResponse,
} from "@repo/api/local/cloud/cloud-schema";
import { defineCommand } from "citty";
import { apiFor, type CliDeps } from "../context";
import { jsonArg, outputJson, writeLines } from "../output";

function describe(status: CloudStatusResponse): string[] {
  switch (status.state) {
    case "off":
      return [
        `not paired  ${new URL(status.cloudUrl).host}`,
        "Run: inteligir sync pair — then approve this device in the browser it opens.",
      ];
    case "unauthorized":
      return [
        `unauthorized  ${new URL(status.cloudUrl).host}  device ${status.deviceId}`,
        status.detail,
      ];
    case "paired": {
      const synced =
        status.lastSyncedAt === null ? "never" : new Date(status.lastSyncedAt).toISOString();
      return [
        `paired  ${new URL(status.cloudUrl).host}  device ${status.deviceId}`,
        `${status.connected ? "following" : "polling"}  ${status.pending} queued  cursor ${status.cursor}  synced ${synced}`,
        ...(status.lastError === null ? [] : [`last error: ${status.lastError}`]),
      ];
    }
  }
}

function describeBegun(begun: CloudPairBeginResponse): string[] {
  const minutes = Math.round(begun.expiresInMs / 60_000);
  return [
    begun.opened
      ? `opened your browser — approve "${begun.deviceName}" there (${minutes} min)`
      : `approve "${begun.deviceName}" here (${minutes} min):`,
    begun.url,
  ];
}

export function syncCommand(deps: CliDeps) {
  return defineCommand({
    meta: {
      name: "sync",
      description: "Account sync: pairing state, pairing, and an immediate thread pass",
    },
    subCommands: {
      status: defineCommand({
        meta: { name: "status", description: "Whether this install is paired, and how far behind" },
        args: { ...jsonArg },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.cloud.status();
          if (outputJson(args, body)) {
            return;
          }
          writeLines(describe(body));
        },
      }),
      pair: defineCommand({
        meta: {
          name: "pair",
          description: "Approve this device in a browser signed in to your account",
        },
        args: {
          name: {
            type: "string",
            description:
              "How this machine appears in the account's device list (default: the hostname)",
          },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          // --json is the agent path, and a browser window nobody asked for is what it must not open.
          const input: CloudPairBeginRequest = { openBrowser: !args.json };
          if (args.name !== undefined) {
            input.deviceName = args.name;
          }
          const body = await api.cloud.pairBegin(input);
          if (outputJson(args, body)) {
            return;
          }
          writeLines(describeBegun(body));
        },
      }),
      push: defineCommand({
        meta: {
          name: "push",
          description: "Run a sync pass now — drain the outbox, pull, apply — and print the state",
        },
        args: { ...jsonArg },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.cloud.syncNow();
          if (outputJson(args, body)) {
            return;
          }
          writeLines(describe(body));
        },
      }),
    },
  });
}
