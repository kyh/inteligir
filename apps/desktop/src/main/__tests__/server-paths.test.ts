import { describe, expect, it } from "vitest";
import { resolveServerEntry, resolveServerRuntime, serverProcessEnv } from "../server-paths";

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

  it("strips an inherited ELECTRON_RUN_AS_NODE for a plain node child", () => {
    const env = serverProcessEnv({ ELECTRON_RUN_AS_NODE: "1" }, "node", {});
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });
});
