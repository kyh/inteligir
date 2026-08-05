import { describe, expect, it } from "vitest";
import type os from "node:os";

import { BIND_ALL_ADDRESS } from "@repo/bridge/remote-access";
import {
  classifyEndpoints,
  resolveBindHosts,
  LOOPBACK_ADDRESS,
  type InterfaceTable,
} from "../network-endpoints";

function ipv4(
  address: string,
  internal = false,
  netmask = "255.255.255.0",
): os.NetworkInterfaceInfo {
  return {
    address,
    netmask,
    family: "IPv4",
    mac: "00:00:00:00:00:00",
    internal,
    cidr: `${address}/24`,
  };
}

/** A point-to-point overlay address: CGNAT range AND a /32. */
function overlay(address: string): os.NetworkInterfaceInfo {
  return ipv4(address, false, "255.255.255.255");
}

const INTERFACES: InterfaceTable = {
  lo0: [ipv4("127.0.0.1", true)],
  en0: [ipv4("192.168.1.42")],
  utun4: [overlay("100.101.102.103")],
  en1: [
    {
      address: "fe80::1",
      netmask: "ffff:ffff:ffff:ffff::",
      family: "IPv6",
      mac: "00:00:00:00:00:00",
      internal: false,
      cidr: "fe80::1/64",
      scopeid: 5,
    },
  ],
};

describe("classifyEndpoints", () => {
  const endpoints = classifyEndpoints(INTERFACES, 47890);

  it("classifies loopback, LAN and overlay addresses, most private first", () => {
    expect(endpoints.map((endpoint) => [endpoint.wsUrl, endpoint.reachability])).toEqual([
      ["ws://100.101.102.103:47890", "private-network"],
      ["ws://192.168.1.42:47890", "lan"],
      ["ws://127.0.0.1:47890", "loopback"],
    ]);
  });

  it("marks only the private-network endpoint encrypted", () => {
    for (const endpoint of endpoints) {
      expect(endpoint.encrypted).toBe(endpoint.reachability === "private-network");
    }
  });

  it("never claims a plain LAN address is encrypted, whatever the interface is called", () => {
    const misleading = classifyEndpoints({ tailscale0: [ipv4("192.168.1.42")] }, 1);
    expect(misleading).toEqual([
      {
        wsUrl: "ws://192.168.1.42:1",
        reachability: "lan",
        encrypted: false,
        virtual: false,
        label: "tailscale0 192.168.1.42",
      },
    ]);
  });

  it("detects the overlay by address range plus a /32, not by interface name", () => {
    const [detected] = classifyEndpoints({ eth7: [overlay("100.64.0.1")] }, 1);
    expect(detected?.reachability).toBe("private-network");
    expect(detected?.encrypted).toBe(true);
    // Outside 100.64.0.0/10 — a routable public address that merely starts 100.
    const [outside] = classifyEndpoints({ eth7: [overlay("100.128.0.1")] }, 1);
    expect(outside?.reachability).toBe("lan");
    expect(outside?.encrypted).toBe(false);
  });

  // 100.64/10 is carrier-grade NAT space, not overlay space: a Starlink dish or
  // a tethered carrier link leases a real subnet out of it, over a plaintext
  // hop. Only the /32 an overlay assigns corroborates the claim.
  it("refuses to call a CGNAT address with a real subnet mask encrypted", () => {
    const [leased] = classifyEndpoints(
      { en0: [ipv4("100.88.4.7", false, "255.255.252.0")] },
      47890,
    );
    expect(leased?.reachability).toBe("lan");
    expect(leased?.encrypted).toBe(false);
    expect(leased?.label).toBe("en0 100.88.4.7");
  });

  it("stays cleartext when the netmask is missing rather than assuming an overlay", () => {
    const [unknown] = classifyEndpoints({ utun9: [ipv4("100.88.4.7", false, "")] }, 47890);
    expect(unknown?.reachability).toBe("lan");
    expect(unknown?.encrypted).toBe(false);
  });

  // Several CNIs hand pods a /32 out of 100.64/10 to conserve RFC1918, which
  // reproduces the overlay's whole signature over a cleartext bridge on this
  // host. The adapter it sits on is what tells them apart.
  it("refuses to call a /32 CGNAT address on a virtual adapter encrypted", () => {
    for (const name of ["veth0", "docker0"]) {
      const [pod] = classifyEndpoints({ [name]: [overlay("100.96.1.7")] }, 47890);
      expect(pod?.reachability).toBe("lan");
      expect(pod?.encrypted).toBe(false);
      expect(pod?.virtual).toBe(true);
    }
  });

  it("ranks hypervisor and container adapters last, and says so in the label", () => {
    const ordered = classifyEndpoints(
      {
        bridge100: [ipv4("192.168.139.3")],
        docker0: [ipv4("172.17.0.1")],
        en0: [ipv4("192.168.1.42")],
        lo0: [ipv4("127.0.0.1", true)],
      },
      47890,
    );
    expect(ordered.map((endpoint) => endpoint.label)).toEqual([
      "en0 192.168.1.42",
      "This computer",
      "bridge100 192.168.139.3 (virtual)",
      "docker0 172.17.0.1 (virtual)",
    ]);
  });

  it("labels endpoints for humans", () => {
    expect(endpoints.map((endpoint) => endpoint.label)).toEqual([
      "Tailscale",
      "en0 192.168.1.42",
      "This computer",
    ]);
  });

  it("skips IPv6 addresses", () => {
    expect(endpoints.some((endpoint) => endpoint.wsUrl.includes("fe80"))).toBe(false);
  });
});

describe("resolveBindHosts", () => {
  it("binds loopback only while remote access is disabled", () => {
    expect(
      resolveBindHosts({ enabled: false, bindAddress: "100.101.102.103" }, INTERFACES),
    ).toEqual([LOOPBACK_ADDRESS]);
  });

  it("binds every interface with the default bind address", () => {
    expect(resolveBindHosts({ enabled: true, bindAddress: BIND_ALL_ADDRESS }, INTERFACES)).toEqual([
      BIND_ALL_ADDRESS,
    ]);
  });

  it("keeps loopback FIRST alongside a pinned interface so the renderer still connects", () => {
    expect(resolveBindHosts({ enabled: true, bindAddress: "100.101.102.103" }, INTERFACES)).toEqual(
      [LOOPBACK_ADDRESS, "100.101.102.103"],
    );
  });

  it("degrades to loopback when the selected address is no longer assigned", () => {
    expect(resolveBindHosts({ enabled: true, bindAddress: "100.9.9.9" }, INTERFACES)).toEqual([
      LOOPBACK_ADDRESS,
    ]);
  });

  it("collapses a loopback selection to the single loopback bind", () => {
    expect(resolveBindHosts({ enabled: true, bindAddress: "127.0.0.1" }, INTERFACES)).toEqual([
      LOOPBACK_ADDRESS,
    ]);
  });
});
