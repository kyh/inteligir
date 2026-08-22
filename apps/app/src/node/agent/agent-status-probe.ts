// Detect + guide (issue #588): what Settings needs to say per harness — is
// the vendor CLI on PATH, does a credential exist, and what command logs in.
// FACTS, not verdicts: a keychain we cannot read without prompting reports
// "unknown" rather than guessing, and nothing here installs anything — the
// adapters ship with the app, the vendor CLIs are the user's.

import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { execFile } from "node:child_process";
import {
  HARNESSES,
  HARNESS_IDS,
  type HarnessDefinition,
} from "@repo/agent-runtime/acp/harness-registry";

export type CredentialPresence = "present" | "absent" | "unknown";

export interface HarnessProbe {
  id: string;
  displayName: string;
  cliPath: string | null;
  credentials: CredentialPresence;
  loginCommand: string;
}

function binaryOnPath(name: string, env: NodeJS.ProcessEnv): string | null {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir.length === 0) continue;
    const candidate = join(dir, name);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function keychainHasEntry(service: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("security", ["find-generic-password", "-s", service], { timeout: 3_000 }, (error) => {
      resolve(error === null);
    });
  });
}

async function probeCredentials(harness: HarnessDefinition): Promise<CredentialPresence> {
  let sawUnreadableProbe = false;
  for (const probe of harness.credentialProbes) {
    if (probe.kind === "home-file") {
      try {
        if (statSync(join(homedir(), probe.relativePath)).isFile()) return "present";
      } catch {
        continue;
      }
    } else if (process.platform === "darwin") {
      if (await keychainHasEntry(probe.service)) return "present";
    } else {
      sawUnreadableProbe = true;
    }
  }
  return sawUnreadableProbe ? "unknown" : "absent";
}

export async function probeHarnesses(env: NodeJS.ProcessEnv): Promise<HarnessProbe[]> {
  return Promise.all(
    HARNESS_IDS.map(async (id) => {
      const harness = HARNESSES[id];
      return {
        id,
        displayName: harness.displayName,
        cliPath: binaryOnPath(harness.vendorBinary, env),
        credentials: await probeCredentials(harness),
        loginCommand: harness.loginCommand,
      };
    }),
  );
}
