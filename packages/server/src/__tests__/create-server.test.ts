import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BINARY_TAG_STT_PCM, BINARY_TAG_TTS_PCM, encodeBinaryFrame } from "@repo/core/bridge-wire";
import { createWsBridge } from "@repo/core/bridge-ws-client";
import type { EventMethod, IpcEvent } from "@repo/core/ipc-registry";
import type { Host } from "@repo/host/create-host";
import type { WireHandler } from "@repo/host/lib/handler-registry";

import { createServer, type RunningServer } from "../create-server";

// A minimal Host double: only the handlers a test calls are real; the rest
// throw loudly (the completeness of the real map is host's own test).
function fakeHost(handlers: Record<string, WireHandler>) {
  const listeners = new Set<(method: EventMethod, payload: unknown) => void>();
  const handlerMap = new Proxy(handlers, {
    get(target, prop: string) {
      const handler = target[prop];
      if (handler) return handler;
      return () => {
        throw new Error(`no fake handler for "${prop}"`);
      };
    },
  });
  const host = {
    handlers: handlerMap as Host["handlers"],
    events: {
      onAny: (listener: (method: EventMethod, payload: unknown) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    capabilities: { canPickVault: false, canSelfUpdate: false },
    start: () => {},
    dispose: async () => {},
  } as Host;
  const emit = <K extends EventMethod>(method: K, payload: IpcEvent<K>) => {
    for (const listener of listeners) listener(method, payload);
  };
  return { host, emit };
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("socket error")), { once: true });
  });
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.addEventListener("message", (event) => resolve(event.data), { once: true });
  });
}

let assetsDir: string;
let running: RunningServer | null = null;
const sockets: WebSocket[] = [];

beforeEach(() => {
  assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), "inteligir-assets-"));
  fs.writeFileSync(path.join(assetsDir, "index.html"), "<!doctype html><title>app</title>");
  fs.writeFileSync(path.join(assetsDir, "app.js"), "console.log('app')");
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await running?.close();
  running = null;
  fs.rmSync(assetsDir, { recursive: true, force: true });
});

afterAll(() => {
  // createWsBridge reconnects forever by design. Once the suite is done, swap
  // in an inert socket so its retry chain ends instead of keeping the worker
  // alive on backoff timers.
  vi.stubGlobal(
    "WebSocket",
    class InertSocket {
      binaryType = "";
      addEventListener(): void {}
      send(): void {}
      close(): void {}
    },
  );
});

async function boot(handlers: Record<string, WireHandler> = {}) {
  const fake = fakeHost(handlers);
  running = await createServer({ host: fake.host, assetsDir });
  return { ...fake, server: running };
}

function connect(server: RunningServer): WebSocket {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/bridge`);
  socket.binaryType = "arraybuffer";
  sockets.push(socket);
  return socket;
}

describe("createServer", () => {
  it("binds loopback only and reports a usable url", async () => {
    const { server } = await boot();
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
    expect(server.port).toBeGreaterThan(0);
  });

  it("serves static assets with an SPA fallback", async () => {
    const { server } = await boot();
    const asset = await fetch(`${server.url}/app.js`);
    expect(await asset.text()).toContain("console.log");
    const fallback = await fetch(`${server.url}/some/client/route`);
    expect(fallback.status).toBe(200);
    expect(await fallback.text()).toContain("<title>app</title>");
  });

  it("rejects non-loopback Host headers (DNS rebinding)", async () => {
    const { server } = await boot();
    // fetch() silently drops the forbidden Host header — go through raw http.
    const statusFor = (host: string) =>
      new Promise<number>((resolve, reject) => {
        const req = http.get(
          { host: "127.0.0.1", port: server.port, path: "/", headers: { host } },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on("error", reject);
      });
    await expect(statusFor("evil.example.com")).resolves.toBe(403);
    await expect(statusFor(`localhost:${server.port}`)).resolves.toBe(200);
  });

  it("rejects WS upgrades from a cross-origin page", async () => {
    const { server } = await boot();
    // A browser at evil.example.com hits the loopback bridge directly: Host is
    // 127.0.0.1 (allowed) but the browser attaches its own unforgeable Origin.
    const upgrade = (origin: string | undefined) =>
      new Promise<"open" | "rejected">((resolve) => {
        const req = http.request({
          host: "127.0.0.1",
          port: server.port,
          path: "/bridge",
          headers: {
            connection: "Upgrade",
            upgrade: "websocket",
            "sec-websocket-version": "13",
            "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
            ...(origin === undefined ? {} : { origin }),
          },
        });
        req.on("upgrade", (_res, socket) => {
          socket.destroy();
          resolve("open");
        });
        req.on("response", () => resolve("rejected"));
        req.on("error", () => resolve("rejected"));
        req.end();
      });
    await expect(upgrade("http://evil.example.com")).resolves.toBe("rejected");
    await expect(upgrade(`http://127.0.0.1:${server.port}`)).resolves.toBe("open");
    await expect(upgrade(undefined)).resolves.toBe("open");
  });

  it("answers req envelopes from host handlers, including errors", async () => {
    const { server } = await boot({
      getVaultRoot: () => "/tmp/vault",
      readVaultDoc: () => {
        throw new Error("no such file");
      },
    });
    const socket = connect(server);
    await waitForOpen(socket);

    socket.send(JSON.stringify({ t: "req", id: 1, method: "getVaultRoot" }));
    expect(JSON.parse(String(await nextMessage(socket)))).toEqual({
      t: "res",
      id: 1,
      ok: true,
      result: "/tmp/vault",
    });

    socket.send(
      JSON.stringify({ t: "req", id: 2, method: "readVaultDoc", payload: { path: "x" } }),
    );
    expect(JSON.parse(String(await nextMessage(socket)))).toEqual({
      t: "res",
      id: 2,
      ok: false,
      error: "no such file",
    });
  });

  it("routes snd envelopes without a reply", async () => {
    const ttsSend = vi.fn();
    const { server } = await boot({ ttsSend });
    const socket = connect(server);
    await waitForOpen(socket);
    socket.send(JSON.stringify({ t: "snd", method: "ttsSend", payload: { text: "hello" } }));
    await vi.waitFor(() => expect(ttsSend).toHaveBeenCalledWith({ text: "hello" }));
  });

  it("broadcasts host events as evt envelopes to every client", async () => {
    const { server, emit } = await boot();
    const a = connect(server);
    const b = connect(server);
    await Promise.all([waitForOpen(a), waitForOpen(b)]);

    const [messageA, messageB] = [nextMessage(a), nextMessage(b)];
    emit("onVaultChanged", { root: "/v" });
    expect(JSON.parse(String(await messageA))).toEqual({
      t: "evt",
      method: "onVaultChanged",
      payload: { root: "/v" },
    });
    expect(JSON.parse(String(await messageB))).toEqual({
      t: "evt",
      method: "onVaultChanged",
      payload: { root: "/v" },
    });
  });

  it("routes STT binary frames to sendSttAudio with alignment-safe bytes", async () => {
    const received: Float32Array[] = [];
    const { server } = await boot({
      sendSttAudio: (raw) => {
        if (!(raw instanceof Uint8Array)) throw new Error("expected bytes");
        received.push(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4));
      },
    });
    const socket = connect(server);
    await waitForOpen(socket);

    const pcm = new Float32Array([0.25, -1]);
    socket.send(
      encodeBinaryFrame(BINARY_TAG_STT_PCM, new Uint8Array(pcm.buffer, 0, pcm.byteLength)),
    );
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect([...(received[0] ?? [])]).toEqual([0.25, -1]);
  });

  it("sends onTtsAudio as a tagged binary frame, not JSON", async () => {
    const { server, emit } = await boot();
    const socket = connect(server);
    await waitForOpen(socket);

    const message = nextMessage(socket);
    const pcm = new Int16Array([300, -400]);
    // Slice to a standalone ArrayBuffer, as tts-proxy broadcasts.
    emit("onTtsAudio", { audio: pcm.buffer.slice(0) });

    const data = await message;
    expect(data).toBeInstanceOf(ArrayBuffer);
    if (!(data instanceof ArrayBuffer)) return;
    const bytes = new Uint8Array(data);
    expect(bytes[0]).toBe(BINARY_TAG_TTS_PCM);
    expect([...new Int16Array(new Uint8Array(bytes.subarray(1)).buffer)]).toEqual([300, -400]);
  });

  it("interoperates with createWsBridge end to end", async () => {
    const { server, emit } = await boot({
      getVaultRoot: () => "/wire/vault",
      listVault: () => [{ path: "a.md", name: "a.md", kind: "doc" }],
    });
    const bridge = createWsBridge(`ws://127.0.0.1:${server.port}/bridge`);
    await expect(bridge.getVaultRoot()).resolves.toBe("/wire/vault");
    await expect(bridge.listVault()).resolves.toEqual([
      { path: "a.md", name: "a.md", kind: "doc" },
    ]);

    const roots: string[] = [];
    bridge.onVaultChanged(({ root }) => roots.push(root));
    emit("onVaultChanged", { root: "/wire/vault" });
    await vi.waitFor(() => expect(roots).toEqual(["/wire/vault"]));
  });

  it("drops malformed and unknown frames without crashing", async () => {
    const { server } = await boot({ getVaultRoot: () => "/v" });
    const socket = connect(server);
    await waitForOpen(socket);

    socket.send("not json");
    socket.send(JSON.stringify({ t: "req", id: 1, method: "notAMethod" }));
    socket.send(JSON.stringify({ t: "req", id: 2, method: "checkForUpdates" }));

    // Server is still healthy afterwards.
    socket.send(JSON.stringify({ t: "req", id: 3, method: "getVaultRoot" }));
    expect(JSON.parse(String(await nextMessage(socket)))).toEqual({
      t: "res",
      id: 3,
      ok: true,
      result: "/v",
    });
  });
});
