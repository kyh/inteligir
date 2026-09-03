import { chmodSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearDeviceCredential,
  DEVICE_CREDENTIAL_FILE_NAME,
  deviceCredentialPath,
  readDeviceCredential,
  writeDeviceCredential,
} from "../credential-store";
import { makeTempDir } from "../../__tests__/temp-dir";

const CREDENTIAL = { deviceId: "dev_1", credential: `igd_${"a".repeat(64)}` };

describe("the device credential at rest", () => {
  it("round-trips, and appears in no other file in the data dir", () => {
    const dataDir = makeTempDir("inteligir-credential-");
    writeDeviceCredential(dataDir, CREDENTIAL);

    expect(readDeviceCredential(dataDir)).toEqual(CREDENTIAL);

    const leaked = readdirSync(dataDir).filter(
      (name) =>
        name !== DEVICE_CREDENTIAL_FILE_NAME &&
        readFileSync(join(dataDir, name), "utf8").includes(CREDENTIAL.credential),
    );
    expect(leaked).toEqual([]);
  });

  it("is owner-only, and stays owner-only when it already exists", () => {
    const dataDir = makeTempDir("inteligir-credential-");
    const path = deviceCredentialPath(dataDir);
    // writeFileSync ignores mode on an existing file; the chmod is what sets 0644.
    writeFileSync(path, "{}\n", { mode: 0o644 });
    chmodSync(path, 0o644);

    writeDeviceCredential(dataDir, CREDENTIAL);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("reads a missing, empty or malformed file as SIGNED OUT", () => {
    const dataDir = makeTempDir("inteligir-credential-");
    expect(readDeviceCredential(dataDir)).toBeNull();

    writeFileSync(deviceCredentialPath(dataDir), "");
    expect(readDeviceCredential(dataDir)).toBeNull();

    writeFileSync(deviceCredentialPath(dataDir), "not json");
    expect(readDeviceCredential(dataDir)).toBeNull();

    writeFileSync(
      deviceCredentialPath(dataDir),
      JSON.stringify({ deviceId: "dev_1", credential: "nope" }),
    );
    expect(readDeviceCredential(dataDir)).toBeNull();
  });

  it("clears, and clearing a signed-out install is not an error", () => {
    const dataDir = makeTempDir("inteligir-credential-");
    clearDeviceCredential(dataDir);
    writeDeviceCredential(dataDir, CREDENTIAL);
    clearDeviceCredential(dataDir);
    expect(readDeviceCredential(dataDir)).toBeNull();
  });
});
