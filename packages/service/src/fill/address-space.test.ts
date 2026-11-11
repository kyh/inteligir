// Where an address written out sits, read from the host the WHATWG parser writes: every spelling
// of one address lands in one space, a public address stays public, and the special-purpose
// blocks are private or reserved by IANA's registries.

import { describe, expect, it } from "vitest";

import { addressSpace } from "./address-space";

const hostOf = (url: string): string => new URL(url).hostname;

describe("an address written out", () => {
  it.each([
    ["http://93.184.216.34/post"],
    ["http://1.1.1.1/"],
    ["http://8.8.8.8:80/"],
    ["http://[2606:4700:4700::1111]/"],
    ["http://[2001:4860:4860::8888]/"],
  ])("%s is public", (url) => {
    expect(addressSpace(hostOf(url))).toBe("public");
  });

  it.each([
    // this machine, in each spelling a parser reads as it
    ["http://127.0.0.1/"],
    ["http://2130706433/"],
    ["http://0177.0.0.1/"],
    ["http://0x7f.0.0.1/"],
    ["http://0x7f000001/"],
    ["http://127.1/"],
    ["http://0.0.0.0/"],
    ["http://[::1]/"],
    ["http://[::]/"],
    // a home's or an office's network, a carrier's shared space
    ["http://10.1.2.3/"],
    ["http://172.16.0.9/"],
    ["http://172.31.255.255/"],
    ["http://192.168.1.1/"],
    ["http://100.64.0.1/"],
    ["http://[fd00::1]/"],
    ["http://[fec0::1]/"],
    // link-local, and the cloud metadata services in it
    ["http://169.254.169.254/latest/meta-data/"],
    ["http://[fe80::1]/"],
    ["http://[fd00:ec2::254]/"],
    // an IPv4 address carried in an IPv6 one, judged as it
    ["http://[::ffff:127.0.0.1]/"],
    ["http://[::ffff:10.0.0.1]/"],
    ["http://[::ffff:0:192.168.0.1]/"],
    ["http://[::10.0.0.1]/"],
    ["http://[64:ff9b::a00:1]/"],
  ])("%s is private", (url) => {
    expect(addressSpace(hostOf(url))).toBe("private");
  });

  it.each([
    ["http://192.0.2.10/"],
    ["http://198.51.100.7/"],
    ["http://203.0.113.1/"],
    ["http://198.18.0.1/"],
    ["http://192.0.0.8/"],
    ["http://224.0.0.1/"],
    ["http://255.255.255.255/"],
    ["http://[2001:db8::1]/"],
    ["http://[ff02::1]/"],
    ["http://[100::1]/"],
  ])("%s is reserved", (url) => {
    expect(addressSpace(hostOf(url))).toBe("reserved");
  });

  it("is told from a name, which is no address", () => {
    expect(addressSpace(hostOf("https://pages.example/post"))).toBeNull();
    expect(addressSpace(hostOf("http://localhost/"))).toBeNull();
    expect(addressSpace(hostOf("https://172.16.example/"))).toBeNull();
  });

  it("refuses a spelling the parser never writes as reserved, never as a name", () => {
    expect(addressSpace("[1::2::3]")).toBe("reserved");
    expect(addressSpace("[::ffff:1.2.3.4]")).toBe("reserved");
    expect(addressSpace("1.2.3.999")).toBe("reserved");
  });
});
