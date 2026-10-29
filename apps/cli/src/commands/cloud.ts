// status only, on purpose: signing in takes the person's password, signing out stops the library
// syncing through the account, and creating an account takes their invite code, so each is a
// person's act, done in the app's Settings › Account, never a verb for a model to drive.

import { cloudDevicesPageUrl } from "@repo/contract/local/cloud/cloud-schema";
import type { CloudStatusResponse } from "@repo/contract/local/cloud/cloud-schema";
import { defineCommand } from "citty";
import { apiFor } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, outputJson, writeLines } from "../output";

const describe = (status: CloudStatusResponse): string[] => {
  switch (status.state) {
    case "signed-out": {
      return [
        `signed out  ${new URL(status.cloudUrl).host}`,
        ...(status.revokeError === null
          ? []
          : [
              `sign-out did not remove this device from the account: ${status.revokeError}`,
              `Remove it from Devices at ${cloudDevicesPageUrl(status.cloudUrl)}`,
            ]),
        "Sign in from Settings › Account in the app.",
      ];
    }
    case "unauthorized": {
      return [
        `unauthorized  ${new URL(status.cloudUrl).host}  device ${status.deviceId}`,
        status.detail,
      ];
    }
    case "outdated": {
      return [
        `outdated  ${new URL(status.cloudUrl).host}  device ${status.deviceId}`,
        "The cloud no longer syncs this version. Update inteligir (npm i -g inteligir@latest, or the app) and sync resumes as this device.",
      ];
    }
    case "signed-in": {
      return [
        `signed in  ${new URL(status.cloudUrl).host}  device ${status.deviceId}`,
        status.connected
          ? "following: another device's change to the library reaches this one at once"
          : "polling: the library's own timer pulls another device's changes",
        ...(status.lastError === null ? [] : [`last error: ${status.lastError}`]),
      ];
    }
    // no default
  }
};

export const cloudCommand = (deps: CliDeps) =>
  defineCommand({
    meta: {
      description: "The account the library syncs through: whether this install is signed in",
      name: "cloud",
    },
    subCommands: {
      status: defineCommand({
        args: { ...jsonArg },
        meta: {
          description: "Whether this install is signed in, and whether its account socket is up",
          name: "status",
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.cloud.status();
          if (outputJson(args, body)) {
            return;
          }
          writeLines(describe(body));
        },
      }),
    },
  });
