// ws-host ↔ ws-bridge integration over real sockets: an ephemeral-port server
// fed by a hand-built fake host (a partial handler map + an event emitter —
// WsHostSource), with the `ws` package injected as the client's WebSocket.
// Covers auth, invoke/send round-trips, event + binary audio paths, pairing,
// origin policy, the reconnect supervisor, and the offline request queue.

import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { WebSocket as WsWebSocket } from "ws";

import { isRecord } from "@repo/features/ipc";
import type { Bridge, EventMethod, HostMethod } from "@repo/features/ipc-registry";
import { createWsBridge, type WsBridgeStatus } from "@repo/features/ws-bridge";
import {
  WS_CLOSE_FORBIDDEN_ORIGIN,
  WS_CLOSE_UNAUTHORIZED,
  encodeFrame,
  parseServerFrame,
  type ClientFrame,
  type ServerFrame,
} from "@repo/features/ws-protocol";
import type { WireHandler } from "../../lib/handler-registry";
import { RemoteAccessManager } from "../remote-access-manager";
import { startWsHost, type WsHost, type WsHostSource } from "../ws-host";

let cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.toReversed()) await cleanup();
  cleanups = [];
});

function makeManager(port: number): RemoteAccessManager {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-transport-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const manager = new RemoteAccessManager({
    configPath: path.join(dir, "remote-access.json"),
    devicesPath: path.join(dir, "remote-devices.json"),
  });
  cleanups.push(() => manager.close());
  manager.setConfig({ port });
  return manager;
}

type FakeHost = {
  source: WsHostSource;
  emit: (method: EventMethod, payload: unknown) => void;
};

function makeFakeHost(handlers: Partial<Record<HostMethod, WireHandler>>): FakeHost {
  const listeners = new Set<(method: EventMethod, payload: unknown) => void>();
  return {
    source: {
      handlers,
      events: {
        onAny: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      },
    },
    emit: (method, payload) => {
      for (const listener of listeners) listener(method, payload);
    },
  };
}

async function listeningPort(wsHost: WsHost): Promise<number> {
  return await vi.waitFor(() => {
    const port = wsHost.port();
    if (port === null) throw new Error("ws host not listening yet");
    return port;
  });
}

type TestHost = {
  manager: RemoteAccessManager;
  emit: FakeHost["emit"];
  wsHost: WsHost;
  url: string;
  port: number;
};

async function startTestHost(
  handlers: Partial<Record<HostMethod, WireHandler>>,
  options: {
    manager?: RemoteAccessManager;
    shellHandlers?: Parameters<typeof startWsHost>[0]["shellHandlers"];
  } = {},
): Promise<TestHost> {
  const manager = options.manager ?? makeManager(0);
  const fake = makeFakeHost(handlers);
  const wsHost = startWsHost({
    host: fake.source,
    validator: manager.validator,
    manager,
    ...(options.shellHandlers ? { shellHandlers: options.shellHandlers } : {}),
  });
  cleanups.push(() => wsHost.close());
  const port = await listeningPort(wsHost);
  return { manager, emit: fake.emit, wsHost, url: `ws://127.0.0.1:${port}`, port };
}

function connectBridge(url: string, token: string): { bridge: Bridge; statuses: WsBridgeStatus[] } {
  const statuses: WsBridgeStatus[] = [];
  const { bridge, dispose } = createWsBridge({
    url,
    token,
    webSocketImpl: WsWebSocket,
    onStatus: (status) => statuses.push(status),
  });
  cleanups.push(dispose);
  return { bridge, statuses };
}

/** Minimal frame-level client for the paths the Bridge doesn't drive
 * (pairing, bad auth, origin headers). */
class RawClient {
  private readonly sock: WsWebSocket;
  private readonly opened: Promise<void>;
  private readonly messages: string[] = [];
  private readonly messageWaiters: Array<(text: string) => void> = [];
  private closeCode: number | null = null;
  private readonly closeWaiters: Array<(code: number) => void> = [];

  constructor(url: string, origin?: string) {
    this.sock = origin === undefined ? new WsWebSocket(url) : new WsWebSocket(url, { origin });
    this.opened = new Promise((resolve) => this.sock.on("open", resolve));
    this.sock.on("message", (data) => {
      const text = Buffer.isBuffer(data) ? data.toString("utf8") : "";
      const waiter = this.messageWaiters.shift();
      if (waiter) waiter(text);
      else this.messages.push(text);
    });
    this.sock.on("close", (code) => {
      this.closeCode = code;
      for (const waiter of this.closeWaiters.splice(0)) waiter(code);
    });
    this.sock.on("error", () => {});
    cleanups.push(() => this.sock.terminate());
  }

  async waitOpen(): Promise<void> {
    await this.opened;
  }

  async send(frame: ClientFrame): Promise<void> {
    await this.opened;
    this.sock.send(encodeFrame(frame));
  }

  async sendText(text: string): Promise<void> {
    await this.opened;
    this.sock.send(text);
  }

  async sendBinary(bytes: Uint8Array): Promise<void> {
    await this.opened;
    this.sock.send(bytes);
  }

  async nextFrame(): Promise<ServerFrame | null> {
    const queued = this.messages.shift();
    const text =
      queued ?? (await new Promise<string>((resolve) => this.messageWaiters.push(resolve)));
    return parseServerFrame(text);
  }

  async waitClose(): Promise<number> {
    if (this.closeCode !== null) return this.closeCode;
    return await new Promise<number>((resolve) => this.closeWaiters.push(resolve));
  }
}

async function freePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        reject(new Error("no address"));
      }
    });
  });
}

describe("auth", () => {
  it("authenticates with the local token and round-trips invoke + invoke-void", async () => {
    const host = await startTestHost({
      getVaultRoot: () => "/vault/root",
      readVaultDoc: (raw) => Promise.resolve(`doc:${JSON.stringify(raw)}`),
    });
    const { bridge, statuses } = connectBridge(host.url, host.manager.getLocalToken());

    await expect(bridge.getVaultRoot()).resolves.toBe("/vault/root");
    await expect(bridge.readVaultDoc({ path: "a.md" })).resolves.toBe('doc:{"path":"a.md"}');
    expect(statuses).toEqual(["connecting", "connected"]);
  });

  it("closes an invalid token with 4401", async () => {
    const host = await startTestHost({});
    const raw = new RawClient(host.url);
    await raw.send({ t: "auth", token: "wrong" });
    expect(await raw.waitClose()).toBe(WS_CLOSE_UNAUTHORIZED);
  });

  it("closes a request sent before auth with 4401", async () => {
    const host = await startTestHost({ getVaultRoot: () => "/v" });
    const raw = new RawClient(host.url);
    await raw.send({ t: "req", id: 1, method: "getVaultRoot" });
    expect(await raw.waitClose()).toBe(WS_CLOSE_UNAUTHORIZED);
  });
});

describe("dispatch", () => {
  it("surfaces a handler throw (validation error) as a rejected invoke — message only", async () => {
    const host = await startTestHost({
      readVaultDoc: () => {
        throw new Error("[ipc:readVaultDoc] payload validation failed — /path: Expected string");
      },
    });
    const { bridge } = connectBridge(host.url, host.manager.getLocalToken());
    await expect(bridge.readVaultDoc({ path: "a.md" })).rejects.toThrow(
      "[ipc:readVaultDoc] payload validation failed — /path: Expected string",
    );
  });

  it("answers a method nobody implements with a not-available error", async () => {
    const host = await startTestHost({});
    const { bridge } = connectBridge(host.url, host.manager.getLocalToken());
    await expect(bridge.downloadUpdate()).rejects.toThrow(
      "downloadUpdate is not available on this host",
    );
  });

  it("falls back to shellHandlers for shell-owned methods", async () => {
    const state = { status: "idle", version: null, downloadPercent: null, message: null };
    const host = await startTestHost(
      { getVaultRoot: () => "/v" },
      { shellHandlers: { checkForUpdates: () => state } },
    );
    const { bridge } = connectBridge(host.url, host.manager.getLocalToken());
    await expect(bridge.checkForUpdates()).resolves.toEqual(state);
  });

  it("delivers fire-and-forget sends to the handler", async () => {
    const sent: unknown[] = [];
    const host = await startTestHost({
      getVaultRoot: () => "/v",
      ttsSend: (raw) => {
        sent.push(raw);
      },
    });
    const { bridge } = connectBridge(host.url, host.manager.getLocalToken());
    await bridge.getVaultRoot(); // ensure welcomed — sends are dropped before
    bridge.ttsSend({ text: "hello" });
    await vi.waitFor(() => {
      expect(sent).toEqual([{ text: "hello" }]);
    });
  });
});

describe("events + binary audio", () => {
  it("broadcasts host events to authed clients", async () => {
    const host = await startTestHost({ getVaultRoot: () => "/v" });
    const { bridge } = connectBridge(host.url, host.manager.getLocalToken());
    const seen: Array<{ root: string }> = [];
    bridge.onVaultChanged((event) => seen.push(event));
    await bridge.getVaultRoot();

    host.emit("onVaultChanged", { root: "/v" });
    await vi.waitFor(() => {
      expect(seen).toEqual([{ root: "/v" }]);
    });
  });

  it("delivers sendSttAudio as a standalone ArrayBuffer, honoring view offsets", async () => {
    let received: unknown = null;
    const host = await startTestHost({
      getVaultRoot: () => "/v",
      sendSttAudio: (raw) => {
        received = raw;
      },
    });
    const { bridge } = connectBridge(host.url, host.manager.getLocalToken());
    await bridge.getVaultRoot();

    const backing = new Float32Array([9, 8, 7, 6, 5]);
    bridge.sendSttAudio(backing.subarray(1, 4)); // byteOffset 4, values [8, 7, 6]
    await vi.waitFor(() => {
      expect(received).toBeInstanceOf(ArrayBuffer);
    });
    expect(received instanceof ArrayBuffer && [...new Float32Array(received)]).toEqual([8, 7, 6]);
  });

  it("ships onTtsAudio as binary and reconstitutes { audio } client-side", async () => {
    const host = await startTestHost({ getVaultRoot: () => "/v" });
    const { bridge } = connectBridge(host.url, host.manager.getLocalToken());
    const chunks: ArrayBuffer[] = [];
    bridge.onTtsAudio((event) => chunks.push(event.audio));
    await bridge.getVaultRoot();

    const pcm = new Int16Array([1000, -2000, 3000]);
    host.emit("onTtsAudio", { audio: pcm.buffer });
    await vi.waitFor(() => {
      expect(chunks).toHaveLength(1);
    });
    expect(chunks[0] && [...new Int16Array(chunks[0])]).toEqual([1000, -2000, 3000]);
  });
});

describe("pairing", () => {
  it("exchanges a one-time pairing token for a device token that authenticates", async () => {
    const host = await startTestHost({ getVaultRoot: () => "/v" });
    const pairing = host.manager.createPairingToken();

    const raw = new RawClient(host.url);
    await raw.send({ t: "pair", pairingToken: pairing.token, deviceName: "Pixel" });
    const paired = await raw.nextFrame();
    if (paired?.t !== "paired") throw new Error(`expected paired frame, got ${paired?.t}`);
    expect(await raw.nextFrame()).toEqual({ t: "welcome" });
    expect(host.manager.getState().devices.map((d) => d.name)).toEqual(["Pixel"]);

    // Single use: replaying the pairing token is an auth failure.
    const replay = new RawClient(host.url);
    await replay.send({ t: "pair", pairingToken: pairing.token, deviceName: "Evil" });
    expect(await replay.waitClose()).toBe(WS_CLOSE_UNAUTHORIZED);

    // The minted device token is a full credential…
    const { bridge } = connectBridge(host.url, paired.deviceToken);
    await expect(bridge.getVaultRoot()).resolves.toBe("/v");

    // …until the device is revoked.
    host.manager.revokeDevice(paired.deviceId);
    const revoked = new RawClient(host.url);
    await revoked.send({ t: "auth", token: paired.deviceToken });
    expect(await revoked.waitClose()).toBe(WS_CLOSE_UNAUTHORIZED);
  });
});

describe("origin policy", () => {
  it("rejects a non-local http origin before auth", async () => {
    const host = await startTestHost({});
    const evil = new RawClient(host.url, "https://evil.example");
    expect(await evil.waitClose()).toBe(WS_CLOSE_FORBIDDEN_ORIGIN);
  });

  it("allows loopback dev-server origins", async () => {
    const host = await startTestHost({});
    const dev = new RawClient(host.url, "http://localhost:5173");
    await dev.send({ t: "auth", token: host.manager.getLocalToken() });
    expect(await dev.nextFrame()).toEqual({ t: "welcome" });
  });
});

describe("reconnect supervisor", () => {
  it("reconnects after a server rebind and keeps working", { timeout: 15_000 }, async () => {
    const host = await startTestHost({ getVaultRoot: () => "/v" });
    const { bridge, statuses } = connectBridge(host.url, host.manager.getLocalToken());
    await expect(bridge.getVaultRoot()).resolves.toBe("/v");

    // Pin the config port to the actual bound port; the changed bind target
    // makes the ws host rebind (terminating clients) onto the same port.
    host.manager.setConfig({ port: host.port });
    await vi.waitFor(
      () => {
        expect(statuses).toContain("disconnected");
        expect(statuses[statuses.length - 1]).toBe("connected");
      },
      { timeout: 10_000 },
    );
    await expect(bridge.getVaultRoot()).resolves.toBe("/v");
  });

  it("rejects in-flight requests when the connection drops", async () => {
    const host = await startTestHost({ getVaultRoot: () => new Promise(() => {}) });
    const { bridge } = connectBridge(host.url, host.manager.getLocalToken());
    // Wait until welcomed so the next request goes in-flight, not the queue.
    await expect(bridge.readVaultDoc({ path: "x" })).rejects.toThrow("not available");
    const hanging = bridge.getVaultRoot();
    await host.wsHost.close();
    await expect(hanging).rejects.toThrow('connection lost before "getVaultRoot" resolved');
  });

  it(
    "queues requests while disconnected and flushes them on connect",
    { timeout: 15_000 },
    async () => {
      const port = await freePort();
      const manager = makeManager(port);
      // Bridge first, server later: the first connect attempt fails outright.
      const { bridge, statuses } = connectBridge(`ws://127.0.0.1:${port}`, manager.getLocalToken());
      await vi.waitFor(() => {
        expect(statuses).toContain("disconnected");
      });
      const queued = bridge.getVaultRoot();

      await startTestHost({ getVaultRoot: () => "/late" }, { manager });
      await expect(queued).resolves.toBe("/late");
    },
  );

  it(
    "resolves a Bridge-driven setRemoteAccessConfig toggle in both directions",
    { timeout: 15_000 },
    async () => {
      // A fixed port keeps the client's dial URL valid across the rebinds the
      // toggle causes (0.0.0.0 covers loopback).
      const port = await freePort();
      const manager = makeManager(port);
      const host = await startTestHost(
        {
          getVaultRoot: () => "/v",
          // Mirrors the real handler: manager.setConfig runs (and rebinds)
          // synchronously INSIDE the request — the res frame must still land.
          setRemoteAccessConfig: (raw) =>
            manager.setConfig({ enabled: isRecord(raw) && raw["enabled"] === true }),
        },
        { manager },
      );
      const { bridge, statuses } = connectBridge(host.url, manager.getLocalToken());
      await expect(bridge.getVaultRoot()).resolves.toBe("/v");

      // The rebind drops the socket right after the res lands, so wait out
      // the supervisor's reconnect cycle before probing the data plane again.
      const reconnected = async (from: number): Promise<void> => {
        await vi.waitFor(
          () => {
            expect(statuses.length).toBeGreaterThan(from);
            expect(statuses[statuses.length - 1]).toBe("connected");
          },
          { timeout: 10_000 },
        );
      };

      let mark = statuses.length;
      const enabled = await bridge.setRemoteAccessConfig({ enabled: true });
      expect(enabled.enabled).toBe(true);
      await reconnected(mark);
      await expect(bridge.getVaultRoot()).resolves.toBe("/v");

      mark = statuses.length;
      const disabled = await bridge.setRemoteAccessConfig({ enabled: false });
      expect(disabled.enabled).toBe(false);
      await reconnected(mark);
      await expect(bridge.getVaultRoot()).resolves.toBe("/v");
    },
  );

  it("treats a 4401 close as terminal: unauthorized status, no further attempts", async () => {
    const host = await startTestHost({ getVaultRoot: () => "/v" });
    const { bridge, statuses } = connectBridge(host.url, "wrong-token");
    // Queued before welcome — must be rejected by the terminal auth failure,
    // not sit in the queue forever. (Expectation attached immediately: the
    // rejection lands while we're still waiting on the status.)
    const queued = expect(bridge.getVaultRoot()).rejects.toThrow("unauthorized");
    await vi.waitFor(() => {
      expect(statuses).toContain("unauthorized");
    });
    await queued;
    await expect(bridge.getVaultRoot()).rejects.toThrow("unauthorized");
    // No reconnect: wait past the supervisor's base backoff — no new status.
    const snapshot = [...statuses];
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(statuses).toEqual(snapshot);
  });
});

describe("rebind failure recovery", () => {
  it("retries a failed rebind with backoff until the port frees", { timeout: 20_000 }, async () => {
    const portA = await freePort();
    const manager = makeManager(portA);
    const host = await startTestHost({ getVaultRoot: () => "/v" }, { manager });

    // Occupy the destination port so the rebind's listen fails.
    const portB = await freePort();
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(portB, "127.0.0.1", resolve));

    manager.setConfig({ port: portB });
    await vi.waitFor(() => {
      expect(manager.getListenError()).not.toBeNull();
    });
    expect(manager.getState().listening).toBe(false);
    expect(host.wsHost.port()).toBeNull();

    // Free the port — the backoff retry recovers without another config change.
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
    await vi.waitFor(
      () => {
        expect(host.wsHost.port()).toBe(portB);
      },
      { timeout: 10_000 },
    );
    expect(manager.getState().listening).toBe(true);
    expect(manager.getListenError()).toBeNull();
  });

  it("surfaces a boot-time bind failure through the manager immediately", async () => {
    const port = await freePort();
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(port, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>((resolve) => blocker.close(() => resolve())));

    const manager = makeManager(port);
    const fake = makeFakeHost({});
    const wsHost = startWsHost({ host: fake.source, validator: manager.validator, manager });
    cleanups.push(() => wsHost.close());

    // The error signal (what the shell's waitForWsPort rejects on) lands in
    // milliseconds — no 10s timeout wait.
    await vi.waitFor(
      () => {
        expect(manager.getListenError()).not.toBeNull();
      },
      { timeout: 1_000 },
    );
    expect(wsHost.port()).toBeNull();
  });
});

describe("local-only methods", () => {
  it("denies the admin plane to a paired device but leaves its data plane intact", async () => {
    const reached: string[] = [];
    const host = await startTestHost(
      {
        getVaultRoot: () => "/v",
        // Sentinels prove denial happens BEFORE dispatch. (getRemoteAccessState
        // is deliberately absent — the welcome hydration push would invoke it
        // for every session; denial still precedes the availability check.)
        setRemoteAccessConfig: () => {
          reached.push("setRemoteAccessConfig");
          return null;
        },
        createPairingToken: () => {
          reached.push("createPairingToken");
          return null;
        },
        revokeRemoteDevice: () => {
          reached.push("revokeRemoteDevice");
          return null;
        },
      },
      { shellHandlers: { checkForUpdates: () => "shell-state" } },
    );

    const pairing = host.manager.createPairingToken();
    const raw = new RawClient(host.url);
    await raw.send({ t: "pair", pairingToken: pairing.token, deviceName: "Pixel" });
    const paired = await raw.nextFrame();
    if (paired?.t !== "paired") throw new Error(`expected paired frame, got ${paired?.t}`);

    const device = connectBridge(host.url, paired.deviceToken);
    await expect(device.bridge.getRemoteAccessState()).rejects.toThrow(
      "getRemoteAccessState requires the local device",
    );
    await expect(device.bridge.createPairingToken()).rejects.toThrow(
      "createPairingToken requires the local device",
    );
    await expect(device.bridge.setRemoteAccessConfig({ enabled: true })).rejects.toThrow(
      "setRemoteAccessConfig requires the local device",
    );
    await expect(device.bridge.revokeRemoteDevice({ id: "other" })).rejects.toThrow(
      "revokeRemoteDevice requires the local device",
    );
    await expect(device.bridge.checkForUpdates()).rejects.toThrow(
      "checkForUpdates requires the local device",
    );
    // The data plane still works for the paired device…
    await expect(device.bridge.getVaultRoot()).resolves.toBe("/v");
    expect(reached).toEqual([]);

    // …and the local session keeps the whole surface.
    const local = connectBridge(host.url, host.manager.getLocalToken());
    await expect(local.bridge.checkForUpdates()).resolves.toBe("shell-state");
    await expect(local.bridge.createPairingToken()).resolves.toBeNull();
  });
});

describe("pre-auth bounds", () => {
  it("closes an oversized pre-auth text frame with 1009", async () => {
    const host = await startTestHost({});
    const raw = new RawClient(host.url);
    await raw.sendText(encodeFrame({ t: "auth", token: "x".repeat(8_192) }));
    expect(await raw.waitClose()).toBe(1009);
  });

  it("closes a pre-auth binary frame with 1008", async () => {
    const host = await startTestHost({});
    const raw = new RawClient(host.url);
    await raw.sendBinary(new Uint8Array([1, 2, 3]));
    expect(await raw.waitClose()).toBe(1008);
  });

  it("caps concurrent unauthenticated sockets at 8, rejecting the newest with 1013", async () => {
    const host = await startTestHost({});
    const held = Array.from({ length: 8 }, () => new RawClient(host.url));
    await Promise.all(held.map((client) => client.waitOpen()));

    const rejected = new RawClient(host.url);
    expect(await rejected.waitClose()).toBe(1013);

    // Authing releases a pre-auth slot, so the next connection is accepted.
    const first = held[0];
    if (first === undefined) throw new Error("expected a held client");
    await first.send({ t: "auth", token: host.manager.getLocalToken() });
    expect(await first.nextFrame()).toEqual({ t: "welcome" });
    const admitted = new RawClient(host.url);
    await admitted.send({ t: "auth", token: host.manager.getLocalToken() });
    expect(await admitted.nextFrame()).toEqual({ t: "welcome" });
  });
});

describe("live session revalidation", () => {
  it("closes a revoked device's live socket with 4401", async () => {
    const host = await startTestHost({ getVaultRoot: () => "/v" });
    const pairing = host.manager.createPairingToken();
    const raw = new RawClient(host.url);
    await raw.send({ t: "pair", pairingToken: pairing.token, deviceName: "Pixel" });
    const paired = await raw.nextFrame();
    if (paired?.t !== "paired") throw new Error(`expected paired frame, got ${paired?.t}`);
    expect(await raw.nextFrame()).toEqual({ t: "welcome" });

    host.manager.revokeDevice(paired.deviceId);
    expect(await raw.waitClose()).toBe(WS_CLOSE_UNAUTHORIZED);

    // The dead credential is refused on reconnect too.
    const again = new RawClient(host.url);
    await again.send({ t: "auth", token: paired.deviceToken });
    expect(await again.waitClose()).toBe(WS_CLOSE_UNAUTHORIZED);
  });

  it("logout invalidation drops live remote sockets but keeps the local session", async () => {
    const host = await startTestHost({ getVaultRoot: () => "/v" });
    const { bridge } = connectBridge(host.url, host.manager.getLocalToken());
    await expect(bridge.getVaultRoot()).resolves.toBe("/v");

    const pairing = host.manager.createPairingToken();
    const device = new RawClient(host.url);
    await device.send({ t: "pair", pairingToken: pairing.token, deviceName: "Pixel" });
    const paired = await device.nextFrame();
    if (paired?.t !== "paired") throw new Error(`expected paired frame, got ${paired?.t}`);
    expect(await device.nextFrame()).toEqual({ t: "welcome" });

    host.manager.invalidateCredentials();
    expect(await device.waitClose()).toBe(WS_CLOSE_UNAUTHORIZED);
    const again = new RawClient(host.url);
    await again.send({ t: "auth", token: paired.deviceToken });
    expect(await again.waitClose()).toBe(WS_CLOSE_UNAUTHORIZED);

    // The local renderer's per-boot session survives logout.
    await expect(bridge.getVaultRoot()).resolves.toBe("/v");
  });
});

describe("welcome hydration", () => {
  it(
    "pushes current state for the stateful channels on reconnect — no request needed",
    { timeout: 15_000 },
    async () => {
      const port = await freePort();
      const manager = makeManager(port);
      let syncView: unknown = { phase: "idle" };
      const host = await startTestHost(
        { getVaultRoot: () => "/v", getSyncState: () => syncView },
        { manager },
      );
      const { bridge, statuses } = connectBridge(host.url, manager.getLocalToken());
      const seen: unknown[] = [];
      bridge.onSyncStateChanged((state) => seen.push(state));
      await expect(bridge.getVaultRoot()).resolves.toBe("/v");
      // The first welcome already hydrates.
      await vi.waitFor(() => {
        expect(seen).toContainEqual({ phase: "idle" });
      });

      // Change state while the client is disconnected (rebind kicks it off);
      // no event is ever emitted for the change.
      manager.setConfig({ enabled: true });
      await vi.waitFor(() => {
        expect(statuses).toContain("disconnected");
      });
      syncView = { phase: "healed" };

      await vi.waitFor(
        () => {
          expect(seen).toContainEqual({ phase: "healed" });
        },
        { timeout: 10_000 },
      );
    },
  );
});
