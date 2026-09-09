// facts, not verdicts: a keychain this process cannot read without prompting reports "unknown" rather than guessing.

import { statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { binaryOnPath } from "./binary-on-path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { HARNESSES, HARNESS_IDS } from "@repo/agent-runtime/acp/harness-registry";
import type { HarnessDefinition } from "@repo/agent-runtime/acp/harness-registry";

type CredentialPresence = "present" | "absent" | "unknown";

export interface HarnessProbe {
  id: string;
  displayName: string;
  cliPath: string | null;
  credentials: CredentialPresence;
  loginCommand: string;
}

const execFileAsync = promisify(execFile);

const keychainHasEntry = async (service: string): Promise<boolean> => {
  try {
    await execFileAsync("security", ["find-generic-password", "-s", service], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
};

const probeCredentials = async (harness: HarnessDefinition): Promise<CredentialPresence> => {
  let sawUnreadableProbe = false;
  for (const probe of harness.credentialProbes) {
    if (probe.kind === "home-file") {
      try {
        if (statSync(path.join(homedir(), probe.relativePath)).isFile()) {
          return "present";
        }
      } catch {
        continue;
      }
    } else if (process.platform === "darwin") {
      if (await keychainHasEntry(probe.service)) {
        return "present";
      }
    } else {
      sawUnreadableProbe = true;
    }
  }
  return sawUnreadableProbe ? "unknown" : "absent";
};

export const probeHarnesses = async (env: NodeJS.ProcessEnv): Promise<HarnessProbe[]> =>
  await Promise.all(
    HARNESS_IDS.map(async (id) => {
      const harness = HARNESSES[id];
      return {
        cliPath: binaryOnPath(harness.vendorBinary, env),
        credentials: await probeCredentials(harness),
        displayName: harness.displayName,
        id,
        loginCommand: harness.loginCommand,
      };
    }),
  );
