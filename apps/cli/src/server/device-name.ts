// What this device is called wherever another device names it: the device list, and the
// committer of every vault commit, which a merge elsewhere reads to say whose version it copied
// aside. The name it signed in under wins, so the list and the copies agree.

import { execFile } from "node:child_process";
import { hostname } from "node:os";
import { promisify } from "node:util";
import { normalizeDeviceName } from "@repo/api/cloud/device/device-schema";
import { readDeviceCredential } from "./cloud/credential-store";

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

// read at every ask, so a sign-in or a sign-out renames the next commit with no restart; a
// credential that cannot be read names no device.
export const deviceNameReader =
  (dataDir: string, machineName: string): (() => string) =>
  () => {
    try {
      return readDeviceCredential(dataDir)?.deviceName ?? machineName;
    } catch {
      return machineName;
    }
  };
