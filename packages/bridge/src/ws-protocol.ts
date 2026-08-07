// ---------------------------------------------------------------------------
// WS Bridge wire protocol — the frame vocabulary shared by the ws host
// (server/transport/ws-host.ts) and the ws client (ws-bridge.ts). Text frames
// are JSON; binary frames are [1-byte tag][payload bytes], and WHICH channels
// use them is declared in ipc-registry's BINARY_CHANNELS — this module only
// knows how to frame bytes, never which feature owns them. Isomorphic: no node
// imports — this loads in the browser,
// React Native, and node alike. All inbound parsing goes through the
// type-guard parse functions so a malformed frame is a `null`, never a throw.
// ---------------------------------------------------------------------------

import { isRecord } from "./wire-helpers";

// ---------------------------------------------------------------------------
// Close codes + binary tags
// ---------------------------------------------------------------------------

/** Auth failed (bad token, or the auth deadline elapsed before one arrived). */
export const WS_CLOSE_UNAUTHORIZED = 4401;
/** The connection came from a disallowed HTTP Origin — rejected before auth. */
export const WS_CLOSE_FORBIDDEN_ORIGIN = 4403;

// Binary tag values live in ipc-registry's BINARY_CHANNELS, beside every other
// channel declaration.

// ---------------------------------------------------------------------------
// Text frames
// ---------------------------------------------------------------------------

/** First frame on connect: present a device (or local-renderer) token. */
export type AuthFrame = { t: "auth"; token: string };
/** Invoke / invoke-void request (invoke-void carries no payload). */
export type ReqFrame = { t: "req"; id: number; method: string; payload?: unknown };
/** Fire-and-forget send (except BINARY_CHANNELS sends, which go binary). */
export type SendFrame = { t: "send"; method: string; payload?: unknown };
export type ClientFrame = AuthFrame | ReqFrame | SendFrame;

/** Auth accepted; requests may flow. */
export type WelcomeFrame = { t: "welcome" };
export type ResFrame =
  | { t: "res"; id: number; ok: true; result?: unknown }
  | { t: "res"; id: number; ok: false; error: string };
/** Host event push. */
export type EvtFrame = { t: "evt"; method: string; payload?: unknown };
export type ServerFrame = WelcomeFrame | ResFrame | EvtFrame;

export function encodeFrame(frame: ClientFrame | ServerFrame): string {
  return JSON.stringify(frame);
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return isRecord(parsed) ? parsed : null;
}

export function parseClientFrame(text: string): ClientFrame | null {
  const raw = parseJsonRecord(text);
  if (raw === null) return null;
  switch (raw["t"]) {
    case "auth":
      return typeof raw["token"] === "string" ? { t: "auth", token: raw["token"] } : null;
    case "req":
      return typeof raw["id"] === "number" && typeof raw["method"] === "string"
        ? { t: "req", id: raw["id"], method: raw["method"], payload: raw["payload"] }
        : null;
    case "send":
      return typeof raw["method"] === "string"
        ? { t: "send", method: raw["method"], payload: raw["payload"] }
        : null;
    default:
      return null;
  }
}

export function parseServerFrame(text: string): ServerFrame | null {
  const raw = parseJsonRecord(text);
  if (raw === null) return null;
  switch (raw["t"]) {
    case "welcome":
      return { t: "welcome" };
    case "res": {
      if (typeof raw["id"] !== "number") return null;
      if (raw["ok"] === true) return { t: "res", id: raw["id"], ok: true, result: raw["result"] };
      if (raw["ok"] === false && typeof raw["error"] === "string") {
        return { t: "res", id: raw["id"], ok: false, error: raw["error"] };
      }
      return null;
    }
    case "evt":
      return typeof raw["method"] === "string"
        ? { t: "evt", method: raw["method"], payload: raw["payload"] }
        : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Binary frames — [tag][payload]. Views are copied respecting byteOffset /
// byteLength (node Buffers are pooled views over a larger ArrayBuffer).
// ---------------------------------------------------------------------------

export function encodeBinaryFrame(
  tag: number,
  data: ArrayBuffer | ArrayBufferView,
): Uint8Array<ArrayBuffer> {
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const frame = new Uint8Array(1 + bytes.byteLength);
  frame[0] = tag;
  frame.set(bytes, 1);
  return frame;
}

/** Split a binary frame into tag + a standalone, exactly-sized ArrayBuffer
 * (never a view over the framed bytes, so downstream `new Float32Array(buf)`
 * sees only the payload). */
export function decodeBinaryFrame(
  data: ArrayBuffer | ArrayBufferView,
): { tag: number; payload: ArrayBuffer } | null {
  const view =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const tag = view[0];
  if (tag === undefined) return null;
  const payload = new ArrayBuffer(view.byteLength - 1);
  new Uint8Array(payload).set(view.subarray(1));
  return { tag, payload };
}
