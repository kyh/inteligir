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

/** Partial config patch. The port stays fixed for now — the enable toggle and
 * the bind selection are what cross the Bridge. */
export const RemoteAccessSetConfigSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    /** IPv4 address the ws server binds while remote access is enabled;
     * `BIND_ALL_ADDRESS` means every interface. The host resolves it against
     * the interfaces that actually exist, so a stale value degrades rather
     * than failing the bind. */
    bindAddress: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

/** The every-interface bind — the default, and what a config-version drop must
 * land on, since it is the behaviour that predates the field. */
export const BIND_ALL_ADDRESS = "0.0.0.0";

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

/** How a peer reaches this computer at one address.
 * - `loopback` — this computer only.
 * - `lan` — the local network, in the clear.
 * - `private-network` — a WireGuard-style overlay (Tailscale): an address only
 *   enrolled, peer-authenticated nodes can route to, carried inside a tunnel
 *   that is already encrypted underneath the ws transport. */
export type RemoteEndpointReachability = "loopback" | "lan" | "private-network";

/** One address this computer currently holds. The list is the CANDIDATE set —
 * which of them the ws server actually answers on is `boundAddresses` on the
 * state, not a property of the endpoint. */
export type RemoteEndpoint = {
  readonly wsUrl: string;
  readonly reachability: RemoteEndpointReachability;
  /** True ONLY for `private-network`, where the overlay encrypts and
   * authenticates the hop underneath us. Plain LAN `ws://` is cleartext and
   * must say so: this flag is what the settings copy claims about security. */
  readonly encrypted: boolean;
  /** A hypervisor/container adapter (docker0, vmnet, bridge100…). It binds
   * fine and reaches nobody, so it is listed and labelled but never offered
   * to a device that is trying to pair. */
  readonly virtual: boolean;
  /** For humans — "Tailscale", "en0 192.168.1.42", "This computer". */
  readonly label: string;
};

/** The bare host of an endpoint — the form `bindAddress` stores. */
export function endpointAddress(endpoint: RemoteEndpoint): string {
  return new URL(endpoint.wsUrl).hostname;
}

/** The reactive remote-access state surfaced to the renderer — the payload of
 * both `getRemoteAccessState` and the `onRemoteAccessChanged` event. */
export type RemoteAccessState = {
  readonly enabled: boolean;
  readonly port: number;
  /** Whether the ws server is currently accepting connections. */
  readonly listening: boolean;
  /** Every IPv4 address this computer holds, classified. */
  readonly endpoints: readonly RemoteEndpoint[];
  /** The address the ws server binds while remote access is enabled;
   * `BIND_ALL_ADDRESS` is every interface. Loopback is bound alongside it
   * whatever this says. This is the REQUEST — see `boundAddresses` for what
   * came up. */
  readonly bindAddress: string;
  /** The addresses the ws server actually holds right now, as the bind itself
   * reported them (`BIND_ALL_ADDRESS` means every interface; empty while
   * nothing is listening). Re-deriving this from `bindAddress` and the live
   * interface table is what let a pinned address that never bound — the
   * overlay came up after boot — be offered as reachable. */
  readonly boundAddresses: readonly string[];
  readonly devices: readonly RemoteDeviceInfo[];
};

/** One address a pairing device may dial. Labelled and offered on its own
 * line, never joined into a sentence: the companion's pairing input takes the
 * FIRST url it can find in the pasted text, so a phone off the overlay would
 * otherwise copy an address it cannot reach. */
export type PairingUrl = {
  readonly wsUrl: string;
  readonly label: string;
};

/** A freshly minted one-time pairing token, shown to the user for entry on
 * the other device. Single-use; expires 10 minutes after mint. */
export type PairingInfo = {
  readonly token: string;
  readonly urls: readonly PairingUrl[];
  /** ISO instant the token stops being redeemable. */
  readonly expiresAt: string;
};
