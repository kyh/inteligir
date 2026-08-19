// `inteligir sync …` — this install's pairing with an inteligir account.
//
// Three verbs and no more. `status` and `push` are the two an agent has a real
// use for: knowing whether its work reaches the user's other devices, and
// making sure it has before it reports done. `pair` is here because the machine
// that needs pairing is often a headless one — a box reached over ssh has no
// Settings dialog to click in.
//
// `pair` OPENS NOTHING ITSELF. It asks the server to begin an approval, and the
// server is what launches a browser — the same act whether it was asked for
// from a browser tab, the Electron shell or here, so there is one opener and
// one place it can go wrong. Under `--json` it asks the server NOT to open one:
// that is the agent's path, and a browser window nobody asked for is the
// failure mode a model driving this surface would produce all day.
//
// There is deliberately no `unpair`. Unpairing throws away a queue of writes
// that have not reached the account yet, and that is a person's decision made
// in front of the state it discards, not a verb in the surface built for a
// model to drive.

import type { CloudPairBeginResponse, CloudStatusResponse } from "@repo/server-contract/cloud";
import { defineCommand } from "citty";
import { apiFor, type CliDeps } from "../context";
import { jsonArg, outputJson, requireOk, writeLines } from "../output";

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
      description: "Cloud thread sync: pairing state, pairing, and an immediate pass",
    },
    subCommands: {
      status: defineCommand({
        meta: { name: "status", description: "Whether this install is paired, and how far behind" },
        args: { ...jsonArg },
        run: async ({ args }) => {
          const api = await apiFor(deps);
          const body = await (await requireOk(await api.cloud.status.$get())).json();
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
          const api = await apiFor(deps);
          const response = await api.cloud.pair.begin.$post({
            json: {
              ...(args.name === undefined ? {} : { deviceName: args.name }),
              openBrowser: !args.json,
            },
          });
          const body = await (await requireOk(response)).json();
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
          const api = await apiFor(deps);
          const body = await (await requireOk(await api.cloud.sync.$post())).json();
          if (outputJson(args, body)) {
            return;
          }
          writeLines(describe(body));
        },
      }),
    },
  });
}
