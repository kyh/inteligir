// What this device calls itself when a sign-in names nothing else: the name the account's device
// list shows for it.

import { execFile } from "node:child_process";
import { hostname } from "node:os";
import { promisify } from "node:util";
import { normalizeDeviceName } from "@repo/contract/cloud/device/device-schema";

const execFileAsync = promisify(execFile);

const COMPUTER_NAME_TIMEOUT_MS = 2000;

// the name Finder and AirDrop show, read once at boot: it costs a process, and a rename while the
// app runs reaches the next launch. hostname() is the network spelling ("Kais-MacBook-Pro.local"),
// which nobody chose, so it is only the fallback.
export const readMachineName = async (): Promise<string> => {
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync("scutil", ["--get", "ComputerName"], {
        encoding: "utf-8",
        timeout: COMPUTER_NAME_TIMEOUT_MS,
      });
      const name = stdout.trim();
      if (name !== "") {
        return normalizeDeviceName(name);
      }
    } catch {
      // the network name below
    }
  }
  return normalizeDeviceName(hostname().replace(/\.local$/iu, ""));
};
