import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  clearDeviceCredential,
  deviceCredentialPath,
  writeDeviceCredential,
} from "../cloud/credential-store";
import { deviceNameReader, readMachineName } from "../device-name";
import { makeTempDir } from "./temp-dir";

const CREDENTIAL = { credential: `igd_${"a".repeat(64)}`, deviceId: "dev_1" };

describe("what this device is called", () => {
  it("is the name it signed in under, else the machine's, read at every ask", () => {
    const dataDir = makeTempDir("inteligir-device-name-");
    const deviceName = deviceNameReader(dataDir, "Kai's Mac mini");
    expect(deviceName()).toBe("Kai's Mac mini");

    writeDeviceCredential(dataDir, { ...CREDENTIAL, deviceName: "Studio" });
    expect(deviceName()).toBe("Studio");

    // a sign-in from before the name was kept
    writeDeviceCredential(dataDir, CREDENTIAL);
    expect(deviceName()).toBe("Kai's Mac mini");

    writeFileSync(deviceCredentialPath(dataDir), "not json", "utf-8");
    expect(deviceName()).toBe("Kai's Mac mini");

    clearDeviceCredential(dataDir);
    expect(deviceName()).toBe("Kai's Mac mini");
  });

  it("names this machine as a person would, never by its network name", async () => {
    const name = await readMachineName();
    expect(name.trim()).toBe(name);
    expect(name.length).toBeGreaterThan(0);
    expect(name).not.toMatch(/\.local$/iu);
  });
});
