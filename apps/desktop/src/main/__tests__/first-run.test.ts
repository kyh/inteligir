import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { PROD_DATA_DIR_NAME } from "inteligir/server/config";
import { makeTempDir } from "inteligir/server/testing";
import { describe, expect, it } from "vitest";
import type { FirstRunChoice } from "../../first-run-state";
import {
  folderFactsOf,
  ownSyncOf,
  planFirstRunChoice,
  planLaunch,
  proposedNewVault,
  runFirstRun,
} from "../first-run";
import type { FirstRunPort, OpenPlan } from "../first-run";
import { resolveServerTarget } from "../server-instance";
import type { ServerTarget } from "../server-instance";

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

  it("proposes the default vault a launch would have made", () => {
    expect(proposedNewVault(target())).toEqual({ name: "Inteligir", parent: "/home/me" });
  });
});

// a packaged launch on a scratch home, resolved as main resolves it
const scratchLaunch = () => {
  const homeDir = makeTempDir("inteligir-first-run-");
  const resolve = (vaultDir?: string) =>
    vaultDir === undefined
      ? resolveServerTarget({ env: {}, homeDir, isPackaged: true })
      : resolveServerTarget({ env: {}, homeDir, isPackaged: true, vaultDir });
  const launched = resolve();
  if (launched.kind !== "resolved") {
    throw new Error(launched.error);
  }
  const launch = launched.target;
  const handedOut = {
    folders: new Set<string>(),
    parents: new Set([proposedNewVault(launch).parent]),
  };
  const plan = (choice: FirstRunChoice) =>
    planFirstRunChoice(choice, {
      defaultVaultDir: launch.vaultDir,
      exists: existsSync,
      handedOut,
      resolve: (vaultDir) => resolve(vaultDir),
    });
  return { handedOut, homeDir, launch, plan };
};

describe("the first-run choice", () => {
  it("opens the proposal as offered without a selector", () => {
    const { homeDir, plan } = scratchLaunch();
    expect(plan({ kind: "create", name: " Inteligir ", parent: homeDir })).toEqual({
      kind: "open",
      selector: null,
      vaultDir: path.join(homeDir, "Inteligir"),
    });
  });

  it("points the selector at a new vault anywhere else", () => {
    const { homeDir, plan } = scratchLaunch();
    expect(plan({ kind: "create", name: "Work notes", parent: homeDir })).toEqual({
      kind: "open",
      selector: path.join(homeDir, "Work notes"),
      vaultDir: path.join(homeDir, "Work notes"),
    });
  });

  it.each([
    ["an empty name", "   "],
    ["a name that is a path", "Notes/Work"],
    ["a name Finder spells with a slash", "Notes:Work"],
    ["a hidden name", ".notes"],
    ["the parent itself", ".."],
  ])("refuses %s", (_label, name) => {
    const { homeDir, plan } = scratchLaunch();
    expect(plan({ kind: "create", name, parent: homeDir }).kind).toBe("refused");
  });

  it("refuses a new vault where a folder already is", () => {
    const { homeDir, plan } = scratchLaunch();
    mkdirSync(path.join(homeDir, "Taken"));
    expect(plan({ kind: "create", name: "Taken", parent: homeDir })).toEqual({
      kind: "refused",
      reason: expect.stringContaining("already a folder named Taken"),
    });
  });

  it("refuses a location or a folder main never handed out", () => {
    const { homeDir, plan } = scratchLaunch();
    const elsewhere = path.join(homeDir, "Elsewhere");
    mkdirSync(elsewhere);
    expect(plan({ kind: "create", name: "Notes", parent: elsewhere }).kind).toBe("refused");
    expect(plan({ kind: "open", path: elsewhere }).kind).toBe("refused");
  });

  it("opens a folder main's picker handed out, keeping it where it is", () => {
    const { handedOut, homeDir, plan } = scratchLaunch();
    const folder = path.join(homeDir, "Documents", "Notes");
    mkdirSync(folder, { recursive: true });
    handedOut.folders.add(folder);
    const planned = plan({ kind: "open", path: folder });
    expect(planned.kind).toBe("open");
    expect(planned.kind === "open" && planned.selector).toBe(
      planned.kind === "open" && planned.vaultDir,
    );
  });

  it("refuses a vault inside the data dir, as a boot would, before anything is written", () => {
    const { handedOut, homeDir, plan } = scratchLaunch();
    const dataDir = path.join(homeDir, PROD_DATA_DIR_NAME);
    mkdirSync(dataDir);
    handedOut.parents.add(dataDir);
    expect(plan({ kind: "create", name: "Notes", parent: dataDir }).kind).toBe("refused");
  });
});

describe("a planned first run", () => {
  const LAUNCH = target();
  const ELSEWHERE: OpenPlan = {
    kind: "open",
    selector: "/home/me/Work",
    vaultDir: "/home/me/Work",
  };
  const DEFAULT: OpenPlan = { kind: "open", selector: null, vaultDir: LAUNCH.vaultDir };

  interface Faults {
    boot?: Error;
    clear?: Error;
  }

  // every move lands in one ordered log, so a test reads the sequence main went through
  const fakePort = (faults: Faults = {}) => {
    const moves: string[] = [];
    let selector: string | null = null;
    const port: FirstRunPort = {
      boot: async (booted) => {
        moves.push(`boot ${booted.vaultDir}`);
        if (faults.boot !== undefined) {
          throw faults.boot;
        }
        await Promise.resolve();
      },
      log: () => {},
      resolveTarget: () =>
        selector === null
          ? LAUNCH
          : target({ dataDir: "/home/me/.inteligir/vaults/x", vaultDir: selector }),
      stopServer: async () => {
        moves.push("stop");
        await Promise.resolve();
      },
      writeSelector: (vaultDir) => {
        if (vaultDir === null && faults.clear !== undefined) {
          throw faults.clear;
        }
        moves.push(`select ${String(vaultDir)}`);
        selector = vaultDir;
      },
    };
    return { moves, port, selector: () => selector };
  };

  it("writes the selector, then boots on what it now says", async () => {
    const { moves, port } = fakePort();
    expect(await runFirstRun(port, ELSEWHERE)).toEqual({ ok: true });
    expect(moves).toEqual(["select /home/me/Work", "boot /home/me/Work"]);
  });

  it("writes nothing for the default vault", async () => {
    const { moves, port } = fakePort();
    expect(await runFirstRun(port, DEFAULT)).toEqual({ ok: true });
    expect(moves).toEqual(["boot /home/me/Inteligir"]);
  });

  it("takes the selector back out when the boot fails, and answers why", async () => {
    const { moves, port, selector } = fakePort({ boot: new Error("the disk is full") });
    const outcome = await runFirstRun(port, ELSEWHERE);
    expect(outcome).toEqual({
      ok: false,
      reason: "Could not open /home/me/Work: the disk is full",
    });
    expect(moves).toEqual(["select /home/me/Work", "boot /home/me/Work", "stop", "select null"]);
    expect(selector()).toBeNull();
  });

  it("says so when the selector could not be taken back", async () => {
    const { port } = fakePort({ boot: new Error("the disk is full"), clear: new Error("EACCES") });
    const outcome = await runFirstRun(port, ELSEWHERE);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.reason).toContain("The next launch will try it again (EACCES)");
  });

  it("leaves nothing to take back for the default vault", async () => {
    const { moves, port } = fakePort({ boot: new Error("the disk is full") });
    const outcome = await runFirstRun(port, DEFAULT);
    expect(outcome.ok).toBe(false);
    expect(moves).toEqual(["boot /home/me/Inteligir", "stop"]);
  });
});

describe("what a picked folder already is", () => {
  it.each([
    ["https://github.com/me/notes.git", { host: "github.com", kind: "host" }],
    ["https://token@git.example.com:8443/notes", { host: "git.example.com", kind: "host" }],
    ["ssh://git@gitlab.com/me/notes.git", { host: "gitlab.com", kind: "host" }],
    ["git@github.com:me/notes.git", { host: "github.com", kind: "host" }],
    ["server:notes.git", { host: "server", kind: "host" }],
    ["file:///Users/me/backup.git", { kind: "local" }],
    ["/Users/me/backup.git", { kind: "local" }],
    ["../backup.git", { kind: "local" }],
  ])("%s syncs with %j", (remote, expected) => {
    expect(ownSyncOf(remote)).toEqual(expected);
  });

  it("names the folder's own sync and its notes", () => {
    expect(
      folderFactsOf({
        exists: true,
        externalSync: { kind: "dropbox" },
        isRepo: true,
        noteCount: { capped: false, count: 12 },
        remote: "git@github.com:me/notes.git",
      }),
    ).toEqual({
      externalSync: { kind: "dropbox" },
      noteCount: { capped: false, count: 12 },
      ownSync: { host: "github.com", kind: "host" },
    });
  });

  it("reads a folder gone since the pick as empty", () => {
    expect(folderFactsOf({ exists: false, externalSync: null })).toEqual({
      externalSync: null,
      noteCount: { capped: false, count: 0 },
      ownSync: null,
    });
  });
});
