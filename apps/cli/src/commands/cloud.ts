// no `logout` here on purpose: it discards a queue of unsent writes, a decision for a person in front of
// that state rather than a verb for a model to drive.

import type { CloudLoginRequest, CloudStatusResponse } from "@repo/api/local/cloud/cloud-schema";
import { defineCommand } from "citty";
import { invalidUsage } from "../cli-error";
import { apiFor, type CliDeps } from "../context";
import { jsonArg, outputJson, writeLines } from "../output";
import { promptPassword, readPasswordFromStdin } from "./password-prompt";

function describe(status: CloudStatusResponse): string[] {
  switch (status.state) {
    case "signed-out":
      return [
        `signed out  ${new URL(status.cloudUrl).host}`,
        "Run: inteligir cloud login --email <address> — with your account's password.",
      ];
    case "unauthorized":
      return [
        `unauthorized  ${new URL(status.cloudUrl).host}  device ${status.deviceId}`,
        status.detail,
      ];
    case "signed-in": {
      const synced =
        status.lastSyncedAt === null ? "never" : new Date(status.lastSyncedAt).toISOString();
      return [
        `signed in  ${new URL(status.cloudUrl).host}  device ${status.deviceId}`,
        `${status.connected ? "following" : "polling"}  ${status.pending} queued  cursor ${status.cursor}  synced ${synced}`,
        ...(status.lastError === null ? [] : [`last error: ${status.lastError}`]),
      ];
    }
  }
}

// the password never rides argv when a terminal can take it unseen; `-` is the pipe's way in,
// and --json is the agent path, which gets no prompt to wait on.
async function resolvePassword(args: {
  password?: string | undefined;
  json?: boolean | undefined;
}): Promise<string> {
  if (args.password === "-") {
    return await readPasswordFromStdin();
  }
  if (args.password !== undefined) {
    return args.password;
  }
  if (args.json === true) {
    throw invalidUsage("--password is required under --json (pass `-` to read it from stdin)");
  }
  if (!process.stdin.isTTY) {
    throw invalidUsage(
      "--password is required when stdin is not a terminal (pass `-` to read it from stdin)",
    );
  }
  return await promptPassword("Password");
}

export function cloudCommand(deps: CliDeps) {
  return defineCommand({
    meta: {
      name: "cloud",
      description:
        "Account sync over the cloud: whether this install is signed in, signing in, and an immediate thread pass",
    },
    subCommands: {
      status: defineCommand({
        meta: {
          name: "status",
          description: "Whether this install is signed in, and how far behind",
        },
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
      login: defineCommand({
        meta: {
          name: "login",
          description:
            "Sign this machine in with your account's email and password; it gets its own device credential",
        },
        args: {
          email: { type: "string", required: true, description: "The account's email address" },
          password: {
            type: "string",
            description:
              "The account's password; `-` reads it from stdin. Omitted on a terminal it is prompted for without echo; required under --json",
          },
          name: {
            type: "string",
            description:
              "How this machine appears in the account's device list (default: the hostname)",
          },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const password = await resolvePassword(args);
          const api = apiFor(deps);
          const input: CloudLoginRequest = { email: args.email, password };
          if (args.name !== undefined) {
            input.deviceName = args.name;
          }
          const body = await api.cloud.login(input);
          if (outputJson(args, body)) {
            return;
          }
          writeLines(describe(body));
        },
      }),
      sync: defineCommand({
        meta: {
          name: "sync",
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
