// `inteligir sync …` — this install's pairing with an inteligir account.
//
// Three verbs and no more. `status` and `push` are the two an agent has a real
// use for: knowing whether its work reaches the user's other devices, and
// making sure it has before it reports done. `pair` is here because the code
// comes from a browser and the machine that redeems it is often a headless
// one — a box reached over ssh has no Settings dialog to type into.
//
// There is deliberately no `unpair`. Unpairing throws away a queue of writes
// that have not reached the account yet, and that is a person's decision made
// in front of the state it discards, not a verb in the surface built for a
// model to drive.

import { hostname } from "node:os";
import type { CloudStatusResponse } from "@repo/server-contract/cloud";
import { defineCommand } from "citty";
import { apiFor, type CliDeps } from "../context";
import { jsonArg, outputJson, requireOk, writeLines } from "../output";

function describe(status: CloudStatusResponse): string[] {
  switch (status.state) {
    case "off":
      return [
        `not paired  ${new URL(status.cloudUrl).host}`,
        "Mint a code on your account's Devices page, then: inteligir sync pair <code>",
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
          description: "Redeem a one-time pairing code from your account's Devices page",
        },
        args: {
          code: {
            type: "positional",
            required: true,
            description: "The one-time code, e.g. ABCD-EFGH",
          },
          name: {
            type: "string",
            description: "How this machine appears in the account's device list",
          },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = await apiFor(deps);
          const response = await api.cloud.pair.$post({
            json: { code: args.code, deviceName: args.name ?? hostname() },
          });
          const body = await (await requireOk(response)).json();
          if (outputJson(args, body)) {
            return;
          }
          writeLines(describe(body));
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
