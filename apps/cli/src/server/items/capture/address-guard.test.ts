import { describe, expect, it } from "vitest";

import { classifyAddress, vetAnswer } from "./address-guard";
import type { AddressClass } from "./address-guard";

// numeric host spellings reach the guard as WHATWG URL reduces them: the guarded fetch parses
// every hop with node's URL, so `http://2130706433/` dials what `hostname` says
const hostOf = (url: string): string => new URL(url).hostname.replaceAll(/^\[|\]$/gu, "");

const CASES: readonly [string, AddressClass][] = [
  // this Mac
  ["0.0.0.0", "this-mac"],
  ["0.1.2.3", "this-mac"],
  ["127.0.0.1", "this-mac"],
  ["127.255.0.9", "this-mac"],
  ["::", "this-mac"],
  ["::1", "this-mac"],
  // link-local
  ["169.254.169.254", "link-local"],
  ["169.254.0.1", "link-local"],
  ["fe80::1", "link-local"],
  ["fe80::1%en0", "link-local"],
  ["febf::1", "link-local"],
  // reserved
  ["224.0.0.1", "reserved"],
  ["239.255.255.250", "reserved"],
  ["240.0.0.1", "reserved"],
  ["255.255.255.255", "reserved"],
  ["192.0.0.8", "reserved"],
  ["192.0.2.1", "reserved"],
  ["198.18.0.1", "reserved"],
  ["198.19.255.255", "reserved"],
  ["198.51.100.7", "reserved"],
  ["203.0.113.9", "reserved"],
  ["ff02::1", "reserved"],
  ["2001:db8::1", "reserved"],
  // private
  ["10.0.0.1", "private"],
  ["172.16.0.1", "private"],
  ["172.31.255.255", "private"],
  ["192.168.1.1", "private"],
  ["100.64.0.1", "private"],
  ["100.127.255.255", "private"],
  ["fc00::1", "private"],
  ["fd12:3456::1", "private"],
  ["fec0::1", "private"],
  // public
  ["8.8.8.8", "public"],
  ["172.32.0.1", "public"],
  ["100.128.0.1", "public"],
  ["198.20.0.1", "public"],
  ["1.1.1.1", "public"],
  ["2606:4700::1111", "public"],
  ["2a00:1450:4001:80b::200e", "public"],
  // an IPv6 address carrying an IPv4 one is that address
  ["::ffff:127.0.0.1", "this-mac"],
  ["::ffff:7f00:1", "this-mac"],
  ["::ffff:169.254.169.254", "link-local"],
  ["::ffff:192.168.1.1", "private"],
  ["::ffff:8.8.8.8", "public"],
  ["::127.0.0.1", "this-mac"],
  ["::ffff:0:127.0.0.1", "this-mac"],
  ["64:ff9b::7f00:1", "this-mac"],
  ["64:ff9b::808:808", "public"],
  ["64:ff9b:1::a9fe:a9fe", "link-local"],
  ["64:ff9b:1:c0a8:1:100::", "private"],
  ["2002:7f00:1::", "this-mac"],
  ["2002:a9fe:a9fe::1", "link-local"],
  ["2002:808:808::1", "public"],
  // Teredo: the client's address inverted in the last 32 bits; 80ff:fffe is 127.0.0.1
  ["2001:0:4136:e378:8000:63bf:80ff:fffe", "this-mac"],
  ["2001:0:4136:e378:8000:63bf:f7f7:f7f7", "public"],
  // what the guard cannot read is never let through
  ["not-an-address", "reserved"],
  ["", "reserved"],
];

describe("classifyAddress", () => {
  it.each(CASES)("%s is %s", (address, expected) => {
    expect(classifyAddress(address)).toBe(expected);
  });

  it.each([
    ["http://2130706433/", "this-mac"],
    ["http://0x7f.1/", "this-mac"],
    ["http://127.1/", "this-mac"],
    ["http://0177.0.0.1/", "this-mac"],
    ["http://[::ffff:127.0.0.1]/", "this-mac"],
    ["http://3232235777/", "private"],
  ] as const)("the numeric host %s reduces to an address of class %s", (url, expected) => {
    expect(classifyAddress(hostOf(url))).toBe(expected);
  });
});

describe("vetAnswer", () => {
  it("decides the reach from the saved address's own answer", () => {
    expect(vetAnswer(["public", "public"], null)).toEqual({ ok: true, reach: "public" });
    expect(vetAnswer(["private"], null)).toEqual({ ok: true, reach: "private" });
  });

  it("refuses a whole answer for one address of this Mac, link-local or reserved space", () => {
    expect(vetAnswer(["public", "this-mac"], null)).toEqual({ ok: false, refusal: "this-mac" });
    expect(vetAnswer(["public", "link-local"], "public")).toEqual({
      ok: false,
      refusal: "link-local",
    });
    expect(vetAnswer(["private", "reserved"], "private")).toEqual({
      ok: false,
      refusal: "reserved",
    });
  });

  it("refuses an answer that mixes private and public addresses", () => {
    expect(vetAnswer(["public", "private"], null)).toEqual({ ok: false, refusal: "reserved" });
    expect(vetAnswer(["public", "private"], "private")).toEqual({
      ok: false,
      refusal: "reserved",
    });
  });

  it("enters private space only from private space", () => {
    expect(vetAnswer(["private"], "public")).toEqual({
      ok: false,
      refusal: "private-from-public",
    });
    expect(vetAnswer(["private"], "private")).toEqual({ ok: true, reach: "private" });
    expect(vetAnswer(["public"], "private")).toEqual({ ok: true, reach: "private" });
  });

  it("refuses an empty answer", () => {
    expect(vetAnswer([], null)).toEqual({ ok: false, refusal: "reserved" });
  });
});
