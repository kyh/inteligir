// @vitest-environment jsdom

import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { CLIENT_BUILD_HEADER } from "@repo/contract/cloud/client-build";
import { V1_RPC_PATH, v1Contract } from "@repo/contract/cloud/v1";
import { openMemorySql } from "@repo/library-replica/memory-sql";
import { toast } from "@repo/ui/components/sonner";
import { emit } from "@tauri-apps/api/event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { APP_COMMANDS, LEAVING_EVENT } from "../../shell/ipc-contract";
import type { KeptCredential, ShellConfig } from "../../shell/shell-config";
import { clearShell, mockShell, replicaReplies, reply } from "../../shell/test-support/mock-shell";
import { createShellLeaveGuard, macTransport, openShellLibrary } from "./shell-library";

afterEach(() => {
  clearShell();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
      expect(order).toStrictEqual(["written", "ready"]);
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
    expect(sent.map((headers) => headers.get(CLIENT_BUILD_HEADER))).toStrictEqual([
      "0.6.0+desktop",
      "0.6.0+desktop",
    ]);
    expect(sent.map((headers) => headers.get("authorization"))).toStrictEqual([
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
    await expect(openShellLibrary(createShellLeaveGuard(), () => {})).resolves.toStrictEqual({
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
    const opening = await openShellLibrary(leave, () => {});
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
    expect(tables).toStrictEqual([{ name: "items" }]);
    void library.replica.close();
    memory.close();
  });
});

const os = implement(v1Contract);

type Refusal = "CLIENT_OUTDATED" | "GONE" | "UNAUTHORIZED";

// the cloud over a real RPCHandler, refusing the replica's pull and a wire call as one
const cloudRefusing = (refusal: Refusal) =>
  new RPCHandler({
    account: {
      devices: {
        list: os.account.devices.list.handler(({ errors }) => {
          throw errors[refusal]();
        }),
      },
    },
    library: {
      sync: {
        pull: os.library.sync.pull.handler(({ errors }) => {
          throw errors[refusal]();
        }),
      },
    },
  });

const stubCloud = (cloud: ReturnType<typeof cloudRefusing>): void => {
  vi.stubGlobal("fetch", async (request: Request) => {
    const { response } = await cloud.handle(request, { prefix: V1_RPC_PATH });
    return response ?? new Response(null, { status: 404 });
  });
};

// the Mac's library over a cloud that refuses it, the shell's forget a suite can watch
const openedRefused = async (refusal: Refusal) => {
  stubCloud(cloudRefusing(refusal));
  const memory = await openMemorySql();
  const forget = vi.fn<() => null>(() => null);
  mockShell(
    configReply,
    reply(APP_COMMANDS.credential.restore)(() => KEPT),
    reply(APP_COMMANDS.credential.forget)(forget),
    ...replicaReplies(memory),
  );
  const reload = vi.fn<() => void>();
  const opening = await openShellLibrary(createShellLeaveGuard(), reload);
  if (opening.kind !== "ready") {
    throw new Error(`the library did not open: ${opening.kind}`);
  }
  return { forget, library: opening.library, memory, reload };
};

describe("a credential the cloud no longer takes", () => {
  it("says why when the shell could not let it go, and stays rather than reload onto it", async () => {
    stubCloud(cloudRefusing("UNAUTHORIZED"));
    const failed = vi.spyOn(toast, "error");
    const memory = await openMemorySql();
    mockShell(
      configReply,
      reply(APP_COMMANDS.credential.restore)(() => KEPT),
      reply(APP_COMMANDS.credential.forget)(
        // oxlint-disable-next-line prefer-promise-reject-errors -- the shell rejects with its serialized error, a plain object, which is what this stands in for
        async () => await Promise.reject({ kind: "keychain", message: "User interaction denied" }),
      ),
      ...replicaReplies(memory),
    );
    const reload = vi.fn<() => void>();
    const opening = await openShellLibrary(createShellLeaveGuard(), reload);
    if (opening.kind !== "ready") {
      throw new Error(`the library did not open: ${opening.kind}`);
    }
    const { library } = opening;
    await expect(library.wire.client.account.devices.list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await vi.waitFor(() => {
      expect(failed).toHaveBeenCalledWith(
        "Your Mac's Keychain didn't let Inteligir in. Unlock it, or choose Allow when your Mac asks, then try again.",
        { id: "leave-account" },
      );
    });
    expect(reload).not.toHaveBeenCalled();
    void library.replica.close();
    memory.close();
  });

  it.each(["UNAUTHORIZED", "GONE"] as const)(
    "lets it go when the replica meets %s, though no wire call ran",
    async (refusal) => {
      const { forget, library, memory, reload } = await openedRefused(refusal);
      await library.replica.sync();
      await vi.waitFor(() => {
        expect(reload).toHaveBeenCalledOnce();
      });
      expect(forget).toHaveBeenCalledOnce();
      void library.replica.close();
      memory.close();
    },
  );

  it("lets it go once when the replica and a wire call meet it together", async () => {
    const { forget, library, memory, reload } = await openedRefused("UNAUTHORIZED");
    await Promise.allSettled([library.replica.sync(), library.wire.client.account.devices.list()]);
    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledOnce();
    });
    expect(forget).toHaveBeenCalledOnce();
    void library.replica.close();
    memory.close();
  });
});

describe("a Mac below the cloud's build floor", () => {
  it("keeps its credential and its library, and says to update, however it met the floor", async () => {
    const failed = vi.spyOn(toast, "error");
    const { forget, library, memory, reload } = await openedRefused("CLIENT_OUTDATED");

    await library.replica.sync();
    expect(library.replica.status().failure).toStrictEqual({ end: "outdated", kind: "session" });
    expect(failed).toHaveBeenCalledOnce();
    expect(failed.mock.lastCall?.[0]).toMatch(/too old/u);

    await expect(library.wire.client.account.devices.list()).rejects.toMatchObject({
      code: "CLIENT_OUTDATED",
    });
    expect(failed).toHaveBeenCalledTimes(2);
    expect(failed.mock.lastCall?.[1]).toStrictEqual(failed.mock.calls[0]?.[1]);

    expect(forget).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    void library.replica.close();
    memory.close();
  });
});
