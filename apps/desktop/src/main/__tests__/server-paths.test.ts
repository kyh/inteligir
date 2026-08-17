import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveAppCheckoutDir,
  resolveServerEntry,
  resolveServerRuntime,
  serverProcessEnv,
  sessionPartition,
} from "../server-paths";

describe("resolveServerEntry", () => {
  it("finds the staged app bundle in a checkout", () => {
    // node_modules/inteligir is pnpm's link to apps/launcher, whose build
    // stages the app bundle under dist/apps/app.
    expect(resolveServerEntry("/repo/apps/desktop")).toBe(
      "/repo/apps/desktop/node_modules/inteligir/dist/apps/app/dist-node/main.js",
    );
  });

  it("rewrites an asar path to the unpacked twin", () => {
    // A child process cannot be spawned from inside an archive, which is why
    // electron-builder unpacks node_modules beside it.
    expect(resolveServerEntry("/Applications/Inteligir.app/Contents/Resources/app.asar")).toBe(
      "/Applications/Inteligir.app/Contents/Resources/app.asar.unpacked/node_modules/inteligir/dist/apps/app/dist-node/main.js",
    );
  });

  it("is idempotent — an already-unpacked path is left alone", () => {
    const once = resolveServerEntry("/A/Contents/Resources/app.asar");
    expect(resolveServerEntry("/A/Contents/Resources/app.asar.unpacked")).toBe(once);
  });
});

describe("resolveAppCheckoutDir", () => {
  const scratch: string[] = [];
  afterEach(() => {
    for (const dir of scratch.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("names the sibling apps/app checkout, realpath'd", () => {
    // The dev instance (data dir, vault, port) is derived from the SERVER's
    // own cwd, and `pnpm dev` runs it from apps/app — so the shell has to
    // resolve against that directory, not its own.
    const repo = mkdtempSync(join(tmpdir(), "inteligir-checkout-"));
    scratch.push(repo);
    mkdirSync(join(repo, "apps", "app"), { recursive: true });
    mkdirSync(join(repo, "apps", "desktop"), { recursive: true });
    expect(resolveAppCheckoutDir(join(repo, "apps", "desktop"))).toBe(
      resolveAppCheckoutDir(join(repo, "apps", "app", "..", "desktop")),
    );
    expect(resolveAppCheckoutDir(join(repo, "apps", "desktop")).endsWith("/apps/app")).toBe(true);
  });

  it("returns the joined path when there is no checkout to resolve", () => {
    // A packaged app has nothing under apps/; production derives nothing from
    // this path, so it is returned rather than guessed at.
    expect(resolveAppCheckoutDir("/Applications/Inteligir.app/Contents/Resources/app.asar")).toBe(
      "/Applications/Inteligir.app/Contents/Resources/app",
    );
  });
});

describe("resolveServerRuntime", () => {
  it("runs its own Electron binary as node when packaged", () => {
    expect(
      resolveServerRuntime({ isPackaged: true, execPath: "/A/Contents/MacOS/Inteligir" }),
    ).toEqual({ executablePath: "/A/Contents/MacOS/Inteligir", mode: "electron-node" });
  });

  it("uses the developer's own node in a checkout", () => {
    // The workspace's native modules are built for it; Electron's ABI is not.
    expect(resolveServerRuntime({ isPackaged: false, execPath: "/x/electron" })).toEqual({
      executablePath: "node",
      mode: "node",
    });
  });
});

describe("sessionPartition", () => {
  it("is a persisted partition, never the default session", () => {
    // The default session is shared with everything else this process loads.
    expect(sessionPartition("/Users/kyh/.inteligir")).toMatch(/^persist:inteligir-[0-9a-f]{16}$/u);
  });

  it("is stable for one data dir, so storage survives a relaunch", () => {
    expect(sessionPartition("/Users/kyh/.inteligir")).toBe(
      sessionPartition("/Users/kyh/.inteligir"),
    );
  });

  it("separates two vaults that would otherwise share one port's storage", () => {
    // `http://127.0.0.1:4664` is a shared NAME, not an identity: without this
    // a second vault (and anything ever adopted on that port) reads the
    // first's localStorage, IndexedDB and cookies.
    expect(sessionPartition("/Users/kyh/.inteligir")).not.toBe(
      sessionPartition("/Users/kyh/.inteligir-work"),
    );
  });
});

describe("serverProcessEnv", () => {
  it("marks the packaged runtime as node and carries the overrides", () => {
    const env = serverProcessEnv({ PATH: "/usr/bin" }, "electron-node", {
      INTELIGIR_PORT: "4664",
    });
    expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(env.INTELIGIR_PORT).toBe("4664");
    expect(env.NODE_ENV).toBe("production");
    expect(env.PATH).toBe("/usr/bin");
  });

  it("lets the shell's resolution win over an inherited one", () => {
    // The child always runs a BUILT bundle (hence NODE_ENV=production), but
    // which instance it opens is the shell's answer, not the bundle's — an
    // inherited INTELIGIR_DATA_DIR must not decide it.
    const env = serverProcessEnv({ INTELIGIR_DATA_DIR: "/inherited" }, "node", {
      INTELIGIR_DATA_DIR: "/resolved/data",
      INTELIGIR_VAULT_DIR: "/resolved/vault",
    });
    expect(env.INTELIGIR_DATA_DIR).toBe("/resolved/data");
    expect(env.INTELIGIR_VAULT_DIR).toBe("/resolved/vault");
  });

  it("strips an inherited ELECTRON_RUN_AS_NODE for a plain node child", () => {
    const env = serverProcessEnv({ ELECTRON_RUN_AS_NODE: "1" }, "node", {});
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });
});
