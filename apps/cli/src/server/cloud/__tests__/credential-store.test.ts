// The credential's handling AT REST — the half of pairing that is a fact
// about the filesystem rather than about the wire.

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

    // The whole point of the location: the secret is in the file named for it
    // and nowhere else — not in the database (a sync target), not in config.
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
    // A file inherited from a laxer umask: `writeFileSync`'s mode is ignored
    // for one that already exists, so only the explicit chmod fixes it.
    writeFileSync(path, "{}\n", { mode: 0o644 });
    chmodSync(path, 0o644);

    writeDeviceCredential(dataDir, CREDENTIAL);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("reads a missing, empty or malformed file as NOT PAIRED", () => {
    const dataDir = makeTempDir("inteligir-credential-");
    expect(readDeviceCredential(dataDir)).toBeNull();

    writeFileSync(deviceCredentialPath(dataDir), "");
    expect(readDeviceCredential(dataDir)).toBeNull();

    writeFileSync(deviceCredentialPath(dataDir), "not json");
    expect(readDeviceCredential(dataDir)).toBeNull();

    // A credential that does not match the wire's own grammar is not one: it
    // would be refused on every request forever, which reads to a user as
    // "sync is broken" rather than "this install is not paired".
    writeFileSync(
      deviceCredentialPath(dataDir),
      JSON.stringify({ deviceId: "dev_1", credential: "nope" }),
    );
    expect(readDeviceCredential(dataDir)).toBeNull();
  });

  it("clears, and clearing an unpaired install is not an error", () => {
    const dataDir = makeTempDir("inteligir-credential-");
    clearDeviceCredential(dataDir);
    writeDeviceCredential(dataDir, CREDENTIAL);
    clearDeviceCredential(dataDir);
    expect(readDeviceCredential(dataDir)).toBeNull();
  });
});
