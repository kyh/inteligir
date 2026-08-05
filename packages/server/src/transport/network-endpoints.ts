// ---------------------------------------------------------------------------
// Network endpoints — the pure half of the remote-access bind story: turn the
// OS interface table into classified `RemoteEndpoint`s, and turn the config
// into the list of addresses the ws server should bind. Both take the
// interface table as an argument so they are testable against a fixed one.
//
// IPv4 ONLY, and deliberately so. Every address here is classified, offered in
// the settings picker, bound as a literal host, and printed into a
// `ws://host:port` URL — and each of those needs its own v6 form (a bracketed
// authority, ULA/link-local classification with a zone index, `::` rather than
// `0.0.0.0` as the bind-all address, and a v6-aware `hasAddress`). Offering a
// v6 row before all four exist would mean a picker entry nothing can dial, so
// the table's v6 rows are skipped rather than half-supported.
// ---------------------------------------------------------------------------

import type os from "node:os";

import {
  BIND_ALL_ADDRESS,
  type RemoteEndpoint,
  type RemoteEndpointReachability,
} from "@repo/bridge/remote-access";

/** The shape `os.networkInterfaces()` returns. */
export type InterfaceTable = NodeJS.Dict<os.NetworkInterfaceInfo[]>;

export const LOOPBACK_ADDRESS = "127.0.0.1";
export const LOOPBACK_LABEL = "This computer";

const RANK: Record<RemoteEndpointReachability, number> = {
  "private-network": 0,
  lan: 1,
  loopback: 2,
};

/** The netmask a point-to-point overlay assigns: the node holds exactly its
 * own address and routes everything else through the tunnel. */
const SINGLE_HOST_NETMASK = "255.255.255.255";

function isLoopbackAddress(address: string): boolean {
  return address.startsWith("127.");
}

function isCarrierGradeNatAddress(address: string): boolean {
  const match = /^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(address);
  if (match === null) return false;
  const second = Number(match[1]);
  return second >= 64 && second <= 127;
}

// A WireGuard-style overlay (Tailscale) hands each node a /32 out of the CGNAT
// block 100.64.0.0/10. BOTH halves are required, because 100.64/10 is
// carrier-grade NAT space and not overlay space: a Starlink dish, some carrier
// tethering, and campus/pod networks conserving RFC1918 all lease real subnets
// out of it, over hops that are plain cleartext. The range alone would let one
// of those claim `encrypted: true`, which is the one sentence the settings copy
// makes about the user's security — so a real subnet mask disqualifies it and
// it stays `lan`. Never detect by interface NAME: that is utun* on macOS,
// tailscale* on Linux and something else again on Windows, so it is not a
// contract — it only ever refines the human label.
function isPrivateNetworkAddress(address: string, netmask: string): boolean {
  return netmask === SINGLE_HOST_NETMASK && isCarrierGradeNatAddress(address);
}

function looksLikeTailscale(interfaceName: string): boolean {
  return /^(tailscale|ts|utun)/i.test(interfaceName);
}

// Adapters a hypervisor or container runtime owns. They bind successfully, so
// pinning to one leaves `listening: true` while nothing can ever connect
// through it — a silent dead end. Ranked last, labelled and flagged rather
// than hidden: the address is really there, and a table that is nothing but
// these must not come back empty. Pairing skips them; the picker does not.
function isVirtualAdapter(interfaceName: string): boolean {
  return /^(bridge\d|vmnet|vboxnet|docker|veth|virbr)/i.test(interfaceName);
}

function classify(
  internal: boolean,
  address: string,
  netmask: string,
  interfaceName: string,
): RemoteEndpointReachability {
  if (internal || isLoopbackAddress(address)) return "loopback";
  // A virtual adapter disqualifies the overlay claim before the range/mask
  // pair is even consulted: several CNIs hand pods a /32 out of 100.64/10
  // precisely to conserve RFC1918, which reproduces the overlay's signature
  // exactly while the hop is a plain cleartext bridge on this host.
  if (!isVirtualAdapter(interfaceName) && isPrivateNetworkAddress(address, netmask)) {
    return "private-network";
  }
  return "lan";
}

function labelFor(
  reachability: RemoteEndpointReachability,
  interfaceName: string,
  address: string,
): string {
  if (reachability === "loopback") return LOOPBACK_LABEL;
  if (reachability === "private-network") {
    return looksLikeTailscale(interfaceName) ? "Tailscale" : "Private network";
  }
  return `${interfaceName} ${address}${isVirtualAdapter(interfaceName) ? " (virtual)" : ""}`;
}

/** Every IPv4 address the machine holds, classified and ordered
 * private-network → lan → loopback (most private first, so the pairing path
 * and the settings list both lead with the encrypted option), with virtual
 * adapters after all of them. */
export function classifyEndpoints(interfaces: InterfaceTable, port: number): RemoteEndpoint[] {
  const endpoints: RemoteEndpoint[] = [];
  for (const [interfaceName, addresses] of Object.entries(interfaces)) {
    for (const info of addresses ?? []) {
      if (info.family !== "IPv4") continue;
      const reachability = classify(info.internal, info.address, info.netmask, interfaceName);
      endpoints.push({
        wsUrl: `ws://${info.address}:${port}`,
        reachability,
        // Only the overlay carries its own encryption. LAN ws:// is plaintext.
        encrypted: reachability === "private-network",
        virtual: isVirtualAdapter(interfaceName),
        label: labelFor(reachability, interfaceName, info.address),
      });
    }
  }
  return endpoints.toSorted(
    (a, b) => Number(a.virtual) - Number(b.virtual) || RANK[a.reachability] - RANK[b.reachability],
  );
}

function hasAddress(interfaces: InterfaceTable, address: string): boolean {
  for (const addresses of Object.values(interfaces)) {
    for (const info of addresses ?? []) {
      if (info.family === "IPv4" && info.address === address) return true;
    }
  }
  return false;
}

/** The addresses the ws server binds, in bind order — LOOPBACK FIRST.
 *
 * Loopback is ALWAYS in the list: the desktop's own renderer dials
 * 127.0.0.1 on every launch, and a listening socket binds exactly one
 * address — so pinning remote access to a single interface has to leave a
 * second listener on loopback or it takes the app's own window offline. The
 * caller binds the head first and commits it before attempting the tail, so
 * the order here is load-bearing, not cosmetic.
 * `BIND_ALL_ADDRESS` already covers loopback, so it binds alone. */
export function resolveBindHosts(
  config: { readonly enabled: boolean; readonly bindAddress: string },
  interfaces: InterfaceTable,
): readonly string[] {
  if (!config.enabled) return [LOOPBACK_ADDRESS];
  if (config.bindAddress === BIND_ALL_ADDRESS) return [BIND_ALL_ADDRESS];
  if (isLoopbackAddress(config.bindAddress)) return [LOOPBACK_ADDRESS];
  // An address the machine no longer holds (overlay down, laptop moved
  // networks) fails EADDRNOTAVAIL. Degrade to loopback: the app keeps working
  // and nothing is exposed. The caller resolves this afresh on every bind, so
  // an address that comes back is picked up by the next one.
  if (!hasAddress(interfaces, config.bindAddress)) return [LOOPBACK_ADDRESS];
  return [LOOPBACK_ADDRESS, config.bindAddress];
}
