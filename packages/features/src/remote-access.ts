// ---------------------------------------------------------------------------
// Remote-access contract — the isomorphic shapes the Bridge/IPC registry, the
// host handlers, and the renderer settings UI share for the WS transport's
// device-pairing surface. The manager itself (config + device store + the ws
// server's listening state) lives in server/transport/; this module is only
// the wire contract, so it stays node-free and loads in the renderer too.
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Payload schemas (renderer → host) — validated at the handler boundary.
// ---------------------------------------------------------------------------

/** Partial config patch. The port stays fixed for now — only the enable
 * toggle crosses the Bridge. */
export const RemoteAccessSetConfigSchema = Type.Object(
  { enabled: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);

export const RevokeDeviceSchema = Type.Object(
  { id: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// Result / event shapes (host → renderer).
// ---------------------------------------------------------------------------

/** One paired remote device (token hash stays server-side). */
export type RemoteDeviceInfo = {
  readonly id: string;
  readonly name: string;
  /** ISO instant the device was paired. */
  readonly createdAt: string;
  /** ISO instant the device last authenticated. */
  readonly lastSeenAt: string;
};

/** The reactive remote-access state surfaced to the renderer — the payload of
 * both `getRemoteAccessState` and the `onRemoteAccessChanged` event. */
export type RemoteAccessState = {
  readonly enabled: boolean;
  readonly port: number;
  /** Whether the ws server is currently accepting connections. */
  readonly listening: boolean;
  /** `ws://<lan-addr>:<port>` per non-internal IPv4 interface; empty when
   * remote access is disabled (the server binds loopback only). */
  readonly lanUrls: readonly string[];
  readonly devices: readonly RemoteDeviceInfo[];
};

/** A freshly minted one-time pairing token, shown to the user for entry on
 * the other device. Single-use; expires 10 minutes after mint. */
export type PairingInfo = {
  readonly token: string;
  readonly urls: readonly string[];
  /** ISO instant the token stops being redeemable. */
  readonly expiresAt: string;
};
