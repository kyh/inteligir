// @vitest-environment jsdom

import { CLIENT_BUILD_HEADER } from "@repo/contract/cloud/client-build";
import { openMemorySql } from "@repo/library-replica/memory-sql";
import { emit } from "@tauri-apps/api/event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { APP_COMMANDS, LEAVING_EVENT } from "../../shell/ipc-contract";
import type { KeptCredential, ShellConfig } from "../../shell/shell-config";
import { clearShell, mockShell, replicaReplies, reply } from "../../shell/test-support/mock-shell";
import { createShellLeaveGuard, macTransport, openShellLibrary } from "./shell-library";

afterEach(() => {
  clearShell();
  vi.unstubAllGlobals();
});

const CONFIG: ShellConfig = {
  cloudOrigin: "http://localhost:5174",
  deviceName: "Studio Mac",
  filesOrigin: "inteligir-files://localhost",
  version: "0.6.0",
};
const KEPT: KeptCredential = {
  credential: `igd_${"a".repeat(64)}`,
  deviceId: "device-1",
  email: "owner@example.com",
  userId: "user-1",
};

const configReply = reply(APP_COMMANDS.config)(() => CONFIG);

describe("the Mac's leave guard", () => {
  it("writes what each holder holds when the shell is about to quit, then says it is done", async () => {
    const order: string[] = [];
    mockShell(
      reply(APP_COMMANDS.leaving.ready)(() => {
        order.push("ready");
        return null;
      }),
    );
    const guard = createShellLeaveGuard();
    guard.hold({
      holding: () => true,
      onMove: () => () => {},
      write: async () => {
        await Promise.resolve();
        order.push("written");
      },
    });
    const released = guard.hold({
      holding: () => true,
      onMove: () => () => {},
      write: async () => {
        order.push("released, yet written");
        await Promise.resolve();
      },
    });
    released();
    await emit(LEAVING_EVENT.event, null);
    await vi.waitFor(() => {
      expect(order).toEqual(["written", "ready"]);
    });
  });

  it("says it is done even when a holder could not write, since the shell goes anyway", async () => {
    const ready = vi.fn<() => null>(() => null);
    mockShell(reply(APP_COMMANDS.leaving.ready)(ready));
    const guard = createShellLeaveGuard();
    guard.hold({
      holding: () => true,
      onMove: () => () => {},
      write: async () => {
        await Promise.reject(new Error("the outbox refused"));
      },
    });
    await emit(LEAVING_EVENT.event, null);
    await vi.waitFor(() => {
      expect(ready).toHaveBeenCalledOnce();
    });
  });
});

describe("the Mac's calls to the cloud", () => {
  it("carry the build, and the credential once a sign-in kept one", async () => {
    const sent: Headers[] = [];
    vi.stubGlobal("fetch", async (request: Request) => {
      sent.push(request.headers);
      return await Promise.resolve(new Response(null, { status: 204 }));
    });
    const signedIn = macTransport(CONFIG, KEPT.credential);
    expect(signedIn.origin).toBe(CONFIG.cloudOrigin);
    await signedIn.fetch(new Request(`${CONFIG.cloudOrigin}/v1/rpc/library/check`));
    await macTransport(CONFIG, null).fetch(new Request(`${CONFIG.cloudOrigin}/v1/rpc/account`));
    expect(sent.map((headers) => headers.get(CLIENT_BUILD_HEADER))).toEqual([
      "0.6.0+desktop",
      "0.6.0+desktop",
    ]);
    expect(sent.map((headers) => headers.get("authorization"))).toEqual([
      `Bearer ${KEPT.credential}`,
      null,
    ]);
  });
});

describe("opening the Mac's library", () => {
  it("is the sign-in when the shell kept no credential", async () => {
    mockShell(
      configReply,
      reply(APP_COMMANDS.credential.restore)(() => null),
    );
    expect(await openShellLibrary(createShellLeaveGuard())).toEqual({
      config: CONFIG,
      kind: "signed-out",
    });
  });

  it("opens the account's replica over the shell's SQLite with the credential kept", async () => {
    const memory = await openMemorySql();
    mockShell(
      configReply,
      reply(APP_COMMANDS.credential.restore)(() => KEPT),
      ...replicaReplies(memory),
    );
    const leave = createShellLeaveGuard();
    const opening = await openShellLibrary(leave);
    if (opening.kind !== "ready") {
      throw new Error(`the library did not open: ${opening.kind}`);
    }
    const { library } = opening;
    expect(library.account.email).toBe(KEPT.email);
    expect(library.leave).toBe(leave);
    expect(library.cloud.origin).toBe(CONFIG.cloudOrigin);
    expect(library.fileUrl("b".repeat(64))).toBe(`inteligir-files://localhost/${"b".repeat(64)}`);
    // the replica's schema landed in the shell's database, through its commands
    const tables = await memory.all(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'items'",
      [],
    );
    expect(tables).toEqual([{ name: "items" }]);
    void library.replica.close();
    memory.close();
  });
});
