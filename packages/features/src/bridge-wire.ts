// ---------------------------------------------------------------------------
// Bridge wire protocol — the WebSocket encoding of the IPC registry, shared
// verbatim by the browser client (bridge-ws-client.ts) and the node server
// (@repo/server). Method lists are derived from the registry at runtime, so
// a new channel needs no change here.
//
// Text frames — JSON envelopes, one per message:
//   → { t: "req", id, method, payload? }   invoke / invoke-void call
//   ← { t: "res", id, ok: true,  result? } resolved call
//   ← { t: "res", id, ok: false, error }   rejected call
//   → { t: "snd", method, payload? }       send-kind (fire-and-forget)
//   ← { t: "evt", method, payload? }       event-kind fan-out
//
// Binary frames — 1-byte tag ‖ payload, reserved for the realtime voice PCM
// paths (base64-in-JSON would add 33% + GC churn):
//   0x01 client → server  STT mic PCM: Float32, little-endian, mono, 16 kHz
//   0x02 server → client  TTS speech PCM: int16, little-endian, mono, 24 kHz
//
// Exactly two registry methods ride binary instead of JSON: `sendSttAudio`
// (never a "snd" envelope) and `onTtsAudio` (never an "evt" envelope). The
// UPDATE_METHODS trio never crosses the wire at all — a WS host has no
// self-update, so the client answers those locally.
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import {
  IPC,
  IPC_METHODS,
  UPDATE_METHODS,
  type EventMethod,
  type HostMethod,
  type IpcMethod,
} from "./ipc-registry";

// ---------------------------------------------------------------------------
// Method partitions
// ---------------------------------------------------------------------------

type IpcKind<K extends IpcMethod> = (typeof IPC)[K]["kind"];

/** Methods a client calls with a `req` envelope (awaits a `res`). */
export type WireRequestMethod = {
  [K in HostMethod]: IpcKind<K> extends "invoke" | "invoke-void" ? K : never;
}[HostMethod];

/** Methods a client fires with a `snd` envelope (no reply). */
export type WireSendMethod = Exclude<
  { [K in HostMethod]: IpcKind<K> extends "send" ? K : never }[HostMethod],
  "sendSttAudio"
>;

/** Events the server pushes as `evt` envelopes. */
export type WireEventMethod = Exclude<EventMethod, "onTtsAudio">;

const updateMethods: ReadonlySet<string> = new Set(UPDATE_METHODS);

function isWireRequestMethod(method: IpcMethod): method is WireRequestMethod {
  const kind = IPC[method].kind;
  return (kind === "invoke" || kind === "invoke-void") && !updateMethods.has(method);
}

function isWireSendMethod(method: IpcMethod): method is WireSendMethod {
  return IPC[method].kind === "send" && method !== "sendSttAudio";
}

function isWireEventMethod(method: IpcMethod): method is WireEventMethod {
  return IPC[method].kind === "event" && method !== "onTtsAudio";
}

export const WIRE_REQUEST_METHODS: readonly WireRequestMethod[] =
  IPC_METHODS.filter(isWireRequestMethod);
export const WIRE_SEND_METHODS: readonly WireSendMethod[] = IPC_METHODS.filter(isWireSendMethod);
export const WIRE_EVENT_METHODS: readonly WireEventMethod[] = IPC_METHODS.filter(isWireEventMethod);

// ---------------------------------------------------------------------------
// JSON envelope schemas + typed frames
// ---------------------------------------------------------------------------

const methodLiteral = (methods: readonly string[]) =>
  Type.Union(methods.map((method) => Type.Literal(method)));

export const WireRequestSchema = Type.Object(
  {
    t: Type.Literal("req"),
    id: Type.Integer({ minimum: 1 }),
    method: methodLiteral(WIRE_REQUEST_METHODS),
    payload: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

export const WireSendSchema = Type.Object(
  {
    t: Type.Literal("snd"),
    method: methodLiteral(WIRE_SEND_METHODS),
    payload: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

export const WireResponseSchema = Type.Union([
  Type.Object(
    {
      t: Type.Literal("res"),
      id: Type.Integer({ minimum: 1 }),
      ok: Type.Literal(true),
      result: Type.Optional(Type.Unknown()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      t: Type.Literal("res"),
      id: Type.Integer({ minimum: 1 }),
      ok: Type.Literal(false),
      error: Type.String(),
    },
    { additionalProperties: false },
  ),
]);

export const WireEventSchema = Type.Object(
  {
    t: Type.Literal("evt"),
    method: methodLiteral(WIRE_EVENT_METHODS),
    payload: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

export type WireRequestFrame = {
  t: "req";
  id: number;
  method: WireRequestMethod;
  payload?: unknown;
};
export type WireSendFrame = { t: "snd"; method: WireSendMethod; payload?: unknown };
export type WireClientFrame = WireRequestFrame | WireSendFrame;

export type WireResponseFrame =
  | { t: "res"; id: number; ok: true; result?: unknown }
  | { t: "res"; id: number; ok: false; error: string };
export type WireEventFrame = { t: "evt"; method: WireEventMethod; payload?: unknown };
export type WireServerFrame = WireResponseFrame | WireEventFrame;

export type ParseResult<F> = { ok: true; frame: F } | { ok: false; error: string };

// The schemas' literal unions widen to `string` in Static (they're built from
// a runtime list, not a tuple), so parsing re-proves membership against the
// typed list to hand back a narrow frame without a cast.
function findMethod<T extends string>(list: readonly T[], method: string): T | null {
  for (const item of list) {
    if (item === method) return item;
  }
  return null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Server side: decode a client's text frame into a typed envelope. */
export function parseClientFrame(text: string): ParseResult<WireClientFrame> {
  const raw = parseJson(text);
  if (Value.Check(WireRequestSchema, raw)) {
    const method = findMethod(WIRE_REQUEST_METHODS, raw.method);
    if (method !== null) {
      return {
        ok: true,
        frame: {
          t: "req",
          id: raw.id,
          method,
          ...("payload" in raw ? { payload: raw.payload } : {}),
        },
      };
    }
  }
  if (Value.Check(WireSendSchema, raw)) {
    const method = findMethod(WIRE_SEND_METHODS, raw.method);
    if (method !== null) {
      return {
        ok: true,
        frame: { t: "snd", method, ...("payload" in raw ? { payload: raw.payload } : {}) },
      };
    }
  }
  return { ok: false, error: "unrecognized client frame" };
}

/** Client side: decode a server's text frame into a typed envelope. */
export function parseServerFrame(text: string): ParseResult<WireServerFrame> {
  const raw = parseJson(text);
  if (Value.Check(WireResponseSchema, raw)) {
    if (raw.ok) {
      return {
        ok: true,
        frame: {
          t: "res",
          id: raw.id,
          ok: true,
          ...("result" in raw ? { result: raw.result } : {}),
        },
      };
    }
    return { ok: true, frame: { t: "res", id: raw.id, ok: false, error: raw.error } };
  }
  if (Value.Check(WireEventSchema, raw)) {
    const method = findMethod(WIRE_EVENT_METHODS, raw.method);
    if (method !== null) {
      return {
        ok: true,
        frame: { t: "evt", method, ...("payload" in raw ? { payload: raw.payload } : {}) },
      };
    }
  }
  return { ok: false, error: "unrecognized server frame" };
}

// ---------------------------------------------------------------------------
// Binary frames
// ---------------------------------------------------------------------------

/** Client → server: Float32 little-endian mono PCM @ 16 kHz (STT mic audio). */
export const BINARY_TAG_STT_PCM = 0x01;
/** Server → client: int16 little-endian mono PCM @ 24 kHz (TTS speech). */
export const BINARY_TAG_TTS_PCM = 0x02;

export function encodeBinaryFrame(tag: number, payload: Uint8Array): ArrayBuffer {
  const frame = new Uint8Array(1 + payload.byteLength);
  frame[0] = tag;
  frame.set(payload, 1);
  return frame.buffer;
}

export type BinaryFrame = {
  tag: number;
  /** A fresh offset-0 copy: the in-frame payload starts 1 byte in, which
   * breaks the 2/4-byte alignment Int16Array/Float32Array views require. */
  payload: Uint8Array<ArrayBuffer>;
};

export function decodeBinaryFrame(data: ArrayBuffer | Uint8Array): BinaryFrame | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const tag = bytes[0];
  if (tag === undefined) return null;
  return { tag, payload: new Uint8Array(bytes.subarray(1)) };
}
