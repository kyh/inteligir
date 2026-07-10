import { describe, expect, it } from "vitest";

import type { KnownEnvironment } from "../environment-store";
import { memEnvironmentStore, memStringStore } from "./fakes";
import { createEnvironmentStore } from "../environment-store";

const ENV: KnownEnvironment = {
  name: "192.168.1.5",
  wsUrl: "ws://192.168.1.5:47890",
  deviceId: "device-1",
  deviceToken: "secret-token",
};

describe("environment-store", () => {
  it("round-trips a saved environment", () => {
    const { store } = memEnvironmentStore();
    expect(store.get()).toBeNull();
    store.save(ENV);
    expect(store.get()).toEqual(ENV);
  });

  it("save replaces the previous environment (single-environment)", () => {
    const { store } = memEnvironmentStore();
    store.save(ENV);
    const next: KnownEnvironment = { ...ENV, name: "other", wsUrl: "ws://10.0.0.2:47890" };
    store.save(next);
    expect(store.get()).toEqual(next);
  });

  it("clear forgets the environment", () => {
    const { store, data } = memEnvironmentStore();
    store.save(ENV);
    store.clear();
    expect(store.get()).toBeNull();
    expect(data.size).toBe(0);
  });

  it("persists a versioned list envelope so growing to many environments is non-breaking", () => {
    const { store, data } = memEnvironmentStore();
    store.save(ENV);
    const stored: unknown = JSON.parse([...data.values()][0] ?? "");
    expect(stored).toEqual({ version: 1, environments: [ENV] });
  });

  it("reads the first environment out of a multi-entry envelope", () => {
    const { port } = memStringStore();
    const second: KnownEnvironment = { ...ENV, name: "second" };
    port.set(
      "inteligir.hostEnvironments",
      JSON.stringify({ version: 1, environments: [ENV, second] }),
    );
    expect(createEnvironmentStore(port).get()).toEqual(ENV);
  });

  it.each([
    ["not json", "{{{"],
    ["wrong version", JSON.stringify({ version: 99, environments: [ENV] })],
    ["non-array environments", JSON.stringify({ version: 1, environments: ENV })],
    ["missing fields", JSON.stringify({ version: 1, environments: [{ name: "x" }] })],
    ["non-object entry", JSON.stringify({ version: 1, environments: ["nope"] })],
  ])("treats a corrupt payload as unpaired, never a throw (%s)", (_label, payload) => {
    const { port } = memStringStore();
    port.set("inteligir.hostEnvironments", payload);
    expect(createEnvironmentStore(port).get()).toBeNull();
  });

  it("skips malformed entries but keeps valid ones", () => {
    const { port } = memStringStore();
    port.set(
      "inteligir.hostEnvironments",
      JSON.stringify({ version: 1, environments: [{ bad: true }, ENV] }),
    );
    expect(createEnvironmentStore(port).get()).toEqual(ENV);
  });
});
