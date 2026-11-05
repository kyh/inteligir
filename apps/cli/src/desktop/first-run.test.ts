import { describe, expect, it } from "vitest";
import { planLaunch } from "./first-run";
import type { ServerTarget } from "./server-start";

const target = (overrides: Partial<ServerTarget> = {}): ServerTarget => ({
  dataDir: "/home/me/.inteligir",
  dataDirSource: "default",
  rootDataDir: "/home/me/.inteligir",
  vaultDir: "/home/me/Inteligir",
  vaultDirSource: "default",
  ...overrides,
});

const nothingExists = (): boolean => false;
const everythingExists = (): boolean => true;

describe("the launch decision", () => {
  it.each([
    ["nothing chose a vault and the default is not there", target(), nothingExists, "first-run"],
    ["the default vault is already there", target(), everythingExists, "boot"],
    [
      "config.json names a vault",
      target({ vaultDirSource: "managed-config" }),
      nothingExists,
      "boot",
    ],
    ["the env pins the vault", target({ vaultDirSource: "env" }), nothingExists, "boot"],
    ["the env pins the data dir", target({ dataDirSource: "env" }), nothingExists, "boot"],
  ])("%s → %s", (_label, launch, exists, kind) => {
    expect(planLaunch({ exists, target: launch })).toEqual({ kind, target: launch });
  });
});
