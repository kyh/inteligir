import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { BIND_ALL_ADDRESS } from "@repo/bridge/remote-access";
import type { InterfaceTable } from "../network-endpoints";
import { DEFAULT_REMOTE_ACCESS_PORT, RemoteAccessManager } from "../remote-access-manager";

let cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.toReversed()) cleanup();
  cleanups = [];
});

function ipv4(address: string, internal = false, netmask = "255.255.255.0") {
  return {
    address,
    netmask,
    family: "IPv4" as const,
    mac: "00:00:00:00:00:00",
    internal,
    cidr: `${address}/24`,
  };
}

/** Loopback, one LAN address, and one overlay address (CGNAT range + /32). */
const INTERFACES: InterfaceTable = {
  lo0: [ipv4("127.0.0.1", true)],
  en0: [ipv4("192.168.1.42")],
  utun4: [ipv4("100.101.102.103", false, "255.255.255.255")],
};

function makeManager(seed?: string, interfaces?: InterfaceTable): RemoteAccessManager {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-access-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const configPath = path.join(dir, "remote-access.json");
  if (seed !== undefined) fs.writeFileSync(configPath, seed);
  const manager = new RemoteAccessManager({
    configPath,
    devicesPath: path.join(dir, "remote-devices.json"),
    ...(interfaces === undefined ? {} : { networkInterfaces: () => interfaces }),
  });
  cleanups.push(() => manager.close());
  return manager;
}

describe("remote-access config", () => {
  it("defaults to the every-interface bind, disabled", () => {
    const config = makeManager().getConfig();
    expect(config).toEqual({
      enabled: false,
      port: DEFAULT_REMOTE_ACCESS_PORT,
      bindAddress: BIND_ALL_ADDRESS,
      revision: 0,
    });
  });

  it("drops a pre-bindAddress config to the safe default rather than an empty bind", () => {
    const manager = makeManager(
      JSON.stringify({ version: 1, enabled: true, port: DEFAULT_REMOTE_ACCESS_PORT }),
    );
    expect(manager.getConfig()).toEqual({
      enabled: false,
      port: DEFAULT_REMOTE_ACCESS_PORT,
      bindAddress: BIND_ALL_ADDRESS,
      revision: 0,
    });
  });

  // Re-picking the address already pinned is the only recovery an unbound pin
  // has, so it must read as a change even though every stored field matches.
  it("bumps the revision on a setConfig that changes nothing", () => {
    const manager = makeManager();
    manager.setConfig({ bindAddress: "192.168.1.42" });
    const first = manager.getConfig().revision;
    manager.setConfig({ bindAddress: "192.168.1.42" });
    expect(manager.getConfig().revision).toBeGreaterThan(first);
  });

  it("round-trips a bind selection and surfaces it on the state", () => {
    const manager = makeManager();
    const state = manager.setConfig({ enabled: true, bindAddress: "100.101.102.103" });
    expect(state.bindAddress).toBe("100.101.102.103");
    expect(manager.getConfig().bindAddress).toBe("100.101.102.103");
  });

  it("always reports a loopback endpoint among the candidates", () => {
    const { endpoints } = makeManager().getState();
    expect(endpoints.some((endpoint) => endpoint.reachability === "loopback")).toBe(true);
  });

  it("offers only loopback for pairing while remote access is disabled", () => {
    const manager = makeManager();
    manager.setListening(true, DEFAULT_REMOTE_ACCESS_PORT, null, ["127.0.0.1"]);
    expect(manager.createPairingToken().urls).toEqual([
      { wsUrl: `ws://127.0.0.1:${DEFAULT_REMOTE_ACCESS_PORT}`, label: "This computer" },
    ]);
  });
});

describe("pairing offers", () => {
  function listening(bindAddress: string, boundHosts: readonly string[]): RemoteAccessManager {
    const manager = makeManager(undefined, INTERFACES);
    manager.setConfig({ enabled: true, bindAddress });
    manager.setListening(true, DEFAULT_REMOTE_ACCESS_PORT, null, boundHosts);
    return manager;
  }

  // Encrypted ORDERS the offer, it never narrows it: a phone that is not on
  // the tailnet can only reach the LAN address, and handing it the overlay URL
  // alone would leave it unable to pair at all.
  it("leads with the encrypted URL but keeps the LAN one as a fallback", () => {
    expect(listening(BIND_ALL_ADDRESS, [BIND_ALL_ADDRESS]).createPairingToken().urls).toEqual([
      { wsUrl: `ws://100.101.102.103:${DEFAULT_REMOTE_ACCESS_PORT}`, label: "Tailscale" },
      { wsUrl: `ws://192.168.1.42:${DEFAULT_REMOTE_ACCESS_PORT}`, label: "en0 192.168.1.42" },
    ]);
  });

  it("offers only the pinned address when the bind is pinned", () => {
    const manager = listening("192.168.1.42", ["127.0.0.1", "192.168.1.42"]);
    expect(manager.createPairingToken().urls).toEqual([
      { wsUrl: `ws://192.168.1.42:${DEFAULT_REMOTE_ACCESS_PORT}`, label: "en0 192.168.1.42" },
    ]);
  });

  // The overlay came up after the bind did. The address is on the machine, so
  // re-resolving the config would call it reachable — but no socket answers on
  // it, and offering it as the ONLY url leaves the phone unable to pair.
  it("never offers an address the bind did not report, however available it looks", () => {
    const manager = listening("100.101.102.103", ["127.0.0.1"]);
    expect(manager.getState().boundAddresses).toEqual(["127.0.0.1"]);
    expect(manager.createPairingToken().urls).toEqual([
      { wsUrl: `ws://127.0.0.1:${DEFAULT_REMOTE_ACCESS_PORT}`, label: "This computer" },
    ]);
  });

  // A container bridge binds fine and reaches nobody, so it stays a candidate
  // in the picker while never being handed to a device trying to pair.
  it("drops virtual adapters from the offer under the every-interface bind", () => {
    const manager = makeManager(undefined, {
      ...INTERFACES,
      docker0: [ipv4("172.17.0.1")],
    });
    manager.setConfig({ enabled: true, bindAddress: BIND_ALL_ADDRESS });
    manager.setListening(true, DEFAULT_REMOTE_ACCESS_PORT, null, [BIND_ALL_ADDRESS]);
    expect(manager.getState().endpoints.some((endpoint) => endpoint.virtual)).toBe(true);
    expect(manager.createPairingToken().urls.map((url) => url.wsUrl)).toEqual([
      `ws://100.101.102.103:${DEFAULT_REMOTE_ACCESS_PORT}`,
      `ws://192.168.1.42:${DEFAULT_REMOTE_ACCESS_PORT}`,
    ]);
  });
});
