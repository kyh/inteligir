import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Fake ipcMain records registrations so the wiring modules can be spun for
// real without an Electron process.
vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
  shell: { openExternal: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}));

import { ipcMain } from "electron";

import { registerExecutorIpcHandlers } from "@/main/executor-ipc";
import { registerVaultIpcHandlers } from "@/main/vault-ipc";
import { IPC, type IpcMethod } from "@/shared/ipc-registry";

const mockHandle = vi.mocked(ipcMain.handle);
const mockOn = vi.mocked(ipcMain.on);

// ---------------------------------------------------------------------------
// Static scan — every main-side handler registration goes through the typed
// wrapper `handle("method", …)` (lib/ipc-handler.ts), which carries the registry
// method name as a static token, so scanning main/ source gives the full set of
// channels main claims to serve. New wiring files are picked up automatically by
// the recursive walk.
// ---------------------------------------------------------------------------

const MAIN_DIR = path.resolve(import.meta.dirname, "../main");

function mainSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...mainSourceFiles(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

function scanHandledMethods(filePath: string): Set<string> {
  const source = fs.readFileSync(filePath, "utf8");
  const methods = new Set<string>();
  for (const match of source.matchAll(/\bhandle\(\s*"([A-Za-z0-9_]+)"/g)) {
    const name = match[1];
    if (name !== undefined) methods.add(name);
  }
  for (const match of source.matchAll(
    /ipcMain\.(?:on|handle)\(\s*IPC\.([A-Za-z0-9_]+)\.channel/g,
  )) {
    const name = match[1];
    if (name !== undefined) methods.add(name);
  }
  return methods;
}

function isIpcMethod(name: string): name is IpcMethod {
  return Object.hasOwn(IPC, name);
}

function channelsOf(methods: Iterable<string>): string[] {
  const channels: string[] = [];
  for (const name of methods) {
    if (!isIpcMethod(name)) throw new Error(`'${name}' is not a registry method`);
    channels.push(IPC[name].channel);
  }
  return channels.toSorted();
}

/** Every registry entry the renderer can initiate (invoke / invoke-void /
 * send) — events are main → renderer pushes and need no main-side handler. */
function rendererInitiatedMethods(): string[] {
  return Object.entries(IPC)
    .filter(([, def]) => def.kind !== "event")
    .map(([name]) => name)
    .toSorted();
}

describe("IPC registry completeness", () => {
  it("every renderer-initiated registry entry has a main-side handler registration", () => {
    const handled = new Set<string>();
    for (const file of mainSourceFiles(MAIN_DIR)) {
      for (const method of scanHandledMethods(file)) handled.add(method);
    }
    // Set equality both ways: a registry entry nothing handles is a dead
    // bridge method (renderer invoke would hang/throw); scanning can't
    // produce a non-registry name because handle()'s parameter is typed
    // IpcMethod — but assert anyway so a regex drift fails loudly.
    expect([...handled].toSorted()).toEqual(rendererInitiatedMethods());
  });

  it("registry channels are unique", () => {
    const channels = Object.values(IPC).map((def) => def.channel);
    expect(new Set(channels).size).toBe(channels.length);
  });
});

// ---------------------------------------------------------------------------
// Runtime spin — the two wiring modules light enough to import stand-alone.
// Registering against the fake ipcMain proves the handle() calls the scan
// found actually execute (not dead code behind a condition), and that they
// land on exactly the channels their source claims.
// ---------------------------------------------------------------------------

function registeredChannels(): string[] {
  const fromHandle = mockHandle.mock.calls.map(([channel]) => channel);
  const fromOn = mockOn.mock.calls.map(([channel]) => channel);
  return [...fromHandle, ...fromOn].toSorted();
}

describe("wiring modules register what their source claims", () => {
  beforeEach(() => {
    mockHandle.mockClear();
    mockOn.mockClear();
  });

  it("registerVaultIpcHandlers registers exactly vault-ipc.ts's scanned channels", () => {
    registerVaultIpcHandlers();
    const claimed = channelsOf(scanHandledMethods(path.join(MAIN_DIR, "vault-ipc.ts")));
    expect(registeredChannels()).toEqual(claimed);
  });

  it("registerExecutorIpcHandlers registers exactly executor-ipc.ts's scanned channels", () => {
    registerExecutorIpcHandlers();
    const claimed = channelsOf(scanHandledMethods(path.join(MAIN_DIR, "executor-ipc.ts")));
    expect(registeredChannels()).toEqual(claimed);
  });
});
