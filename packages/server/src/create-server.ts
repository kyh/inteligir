// ---------------------------------------------------------------------------
// createServer — the WebSocket sibling of the desktop's host-fold: binds a
// @repo/host to the bridge-wire protocol (JSON envelopes + tagged binary
// voice frames) and serves the @repo/app static build with an SPA fallback.
//
// Security posture: local single-user, loopback IS the auth gate. The server
// binds 127.0.0.1 only (asserted after listen), and every HTTP request and
// WS upgrade must carry a loopback Host header (DNS-rebinding guard). The WS
// upgrade additionally enforces an Origin allowlist: a WebSocket handshake
// is NOT subject to CORS, so any page the user visits could otherwise open
// ws://127.0.0.1/bridge and drive the vault. Browsers always attach an
// unforgeable Origin, so a loopback-only allowlist shuts that out; a missing
// Origin means a non-browser local client (which already has machine access).
// No accounts, no tokens — anything that can speak to 127.0.0.1 is the user.
// ---------------------------------------------------------------------------

import http from "node:http";
import sirv from "sirv";
import { WebSocketServer, type WebSocket } from "ws";

import {
  BINARY_TAG_STT_PCM,
  BINARY_TAG_TTS_PCM,
  decodeBinaryFrame,
  encodeBinaryFrame,
  parseClientFrame,
} from "@repo/core/bridge-wire";
import { toErrorMessage } from "@repo/core/ipc";
import type { Host } from "@repo/host/create-host";

const LOOPBACK_ADDRESS = "127.0.0.1";
const BRIDGE_PATH = "/bridge";

export type ServerOptions = {
  host: Host;
  /** Directory holding the @repo/app web build (index.html + assets). */
  assetsDir: string;
  /** TCP port; 0 (default) picks a free one. */
  port?: number;
};

export type RunningServer = {
  port: number;
  url: string;
  close: () => Promise<void>;
};

const ALLOWED_HOSTNAMES = new Set([LOOPBACK_ADDRESS, "localhost", "[::1]"]);

/** DNS-rebinding guard: a hostile page at attacker.com resolving to
 * 127.0.0.1 still sends its own Host header — reject anything that isn't
 * explicitly loopback. */
function isAllowedHostHeader(header: string | undefined): boolean {
  if (!header) return false;
  try {
    return ALLOWED_HOSTNAMES.has(new URL(`http://${header}`).hostname);
  } catch {
    return false;
  }
}

/** WS handshakes bypass CORS, so a cross-origin page could otherwise drive
 * the bridge. Browsers always send an unforgeable Origin — require it to be
 * loopback. An absent Origin is a non-browser local client (native tooling
 * that already has full machine access), so it's allowed through. */
function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    return ALLOWED_HOSTNAMES.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data) && data.every((chunk) => chunk instanceof Uint8Array)) {
    return Buffer.concat(data);
  }
  return null;
}

function isTtsAudioPayload(payload: unknown): payload is { audio: ArrayBuffer } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "audio" in payload &&
    payload.audio instanceof ArrayBuffer
  );
}

export async function createServer(options: ServerOptions): Promise<RunningServer> {
  const { host, assetsDir } = options;

  const serveAssets = sirv(assetsDir, { single: true, etag: true });

  const httpServer = http.createServer((req, res) => {
    if (!isAllowedHostHeader(req.headers.host)) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("Forbidden");
      return;
    }
    serveAssets(req, res);
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", `http://${LOOPBACK_ADDRESS}`).pathname;
    if (
      !isAllowedHostHeader(req.headers.host) ||
      !isAllowedOrigin(req.headers.origin) ||
      pathname !== BRIDGE_PATH
    ) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  function broadcast(frame: string | ArrayBuffer): void {
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(frame);
    }
  }

  // One host-event subscription for the whole server; every connected client
  // sees every event (single local user, possibly several tabs). TTS audio
  // rides a tagged binary frame instead of JSON — see bridge-wire.ts.
  const unsubscribeEvents = host.events.onAny((method, payload) => {
    if (method === "onTtsAudio") {
      if (isTtsAudioPayload(payload)) {
        broadcast(encodeBinaryFrame(BINARY_TAG_TTS_PCM, new Uint8Array(payload.audio)));
      }
      return;
    }
    broadcast(JSON.stringify({ t: "evt", method, payload }));
  });

  function handleBinary(data: unknown): void {
    const bytes = toBytes(data);
    if (!bytes) return;
    const frame = decodeBinaryFrame(bytes);
    // decodeBinaryFrame copies the payload to offset 0, so the Float32 view
    // the STT handler builds over it is alignment-safe.
    if (frame?.tag === BINARY_TAG_STT_PCM) {
      host.handlers.sendSttAudio(frame.payload);
    }
  }

  async function handleText(ws: WebSocket, text: string): Promise<void> {
    const parsed = parseClientFrame(text);
    if (!parsed.ok) {
      console.warn(`[server] dropped client frame: ${parsed.error}`);
      return;
    }
    const frame = parsed.frame;
    if (frame.t === "snd") {
      // Fire-and-forget; the host's handler wrapper already swallows + logs.
      host.handlers[frame.method](frame.payload);
      return;
    }
    let response: string;
    try {
      const result = await host.handlers[frame.method](frame.payload);
      response = JSON.stringify({
        t: "res",
        id: frame.id,
        ok: true,
        ...(result === undefined ? {} : { result }),
      });
    } catch (err) {
      response = JSON.stringify({ t: "res", id: frame.id, ok: false, error: toErrorMessage(err) });
    }
    if (ws.readyState === ws.OPEN) ws.send(response);
  }

  wss.on("connection", (ws) => {
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        handleBinary(data);
        return;
      }
      // ws hands text frames over as a Buffer; the protocol is UTF-8 JSON.
      const bytes = toBytes(data);
      if (bytes) void handleText(ws, Buffer.from(bytes).toString("utf8"));
    });
    ws.on("error", (err) => {
      console.warn("[server] websocket error:", err);
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port ?? 0, LOOPBACK_ADDRESS, resolve);
  });

  const address = httpServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("server bound to a pipe instead of a TCP port");
  }
  // Loopback is the auth gate — refuse to run on anything else.
  if (address.address !== LOOPBACK_ADDRESS) {
    httpServer.close();
    throw new Error(`refusing non-loopback bind: ${address.address}`);
  }

  return {
    port: address.port,
    url: `http://${LOOPBACK_ADDRESS}:${address.port}`,
    close: async () => {
      unsubscribeEvents();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
