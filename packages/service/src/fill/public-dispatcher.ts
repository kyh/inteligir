// Where the fill's fetch connects: undici's Agent, whose every connection asks a lookup that resolves
// the name and refuses it whole when any address it answers is private, loopback, link-local,
// reserved or an IPv4 address spelled as IPv6 into one of those. The socket then connects to an
// address the lookup vetted, so a name that resolves differently a moment later (DNS rebinding)
// never reaches inside. The ranges are eve's web fetch's, which it does not export
// (eve/dist/src/shared/network-address.js), with loopback added.

import { promises as dns } from "node:dns";
import type { LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import type { LookupFunction } from "node:net";

import { Agent } from "undici";

const IPV4_SUBNETS: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const IPV6_SUBNETS: readonly (readonly [string, number])[] = [
  ["::", 128],
  ["::1", 128],
  ["::", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];

const PRIVATE = new BlockList();
for (const [network, prefix] of IPV4_SUBNETS) {
  PRIVATE.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of IPV6_SUBNETS) {
  PRIVATE.addSubnet(network, prefix, "ipv6");
}

const MAPPED = /^::ffff:(?<v4>\d+\.\d+\.\d+\.\d+)$/iu;

// an address a resolver answered that the fill never connects to: one in a private range, an IPv4
// one written as `::ffff:a.b.c.d` judged as itself, and anything that is no address at all
export const isPrivateAddress = (address: string): boolean => {
  const bare = address.replace(/%.*$/u, "");
  const plain = MAPPED.exec(bare)?.groups?.v4 ?? bare;
  const family = isIP(plain);
  return family === 0 || PRIVATE.check(plain, family === 4 ? "ipv4" : "ipv6");
};

// a name that resolved into private space, which the fetch says as the hop's refusal
export class PrivateAddressError extends Error {
  readonly host: string;

  constructor(host: string) {
    super(`${host} resolves to an address the fill does not reach`);
    this.name = "PrivateAddressError";
    this.host = host;
  }
}

// every address a name resolves to, in the resolver's order
export type Resolve = (host: string) => Promise<readonly LookupAddress[]>;

const resolveAll: Resolve = async (host) =>
  await dns.lookup(host, { all: true, order: "verbatim" });

const familyOf = (family: number | string | undefined): number => {
  switch (family) {
    case 4:
    case "IPv4": {
      return 4;
    }
    case 6:
    case "IPv6": {
      return 6;
    }
    default: {
      return 0;
    }
  }
};

type LookupAnswer = Parameters<LookupFunction>[2];

const unresolved = (host: string): Error =>
  Object.assign(new Error(`${host} has no address of the family asked`), { code: "ENOTFOUND" });

// the name refused whole when any address is private, else answered as the connect asked: every
// address of the family it named, or the first
const answerLookup = async (
  resolve: Resolve,
  host: string,
  options: Parameters<LookupFunction>[1],
  answer: LookupAnswer,
): Promise<void> => {
  let addresses: readonly LookupAddress[];
  try {
    addresses = await resolve(host);
  } catch (error) {
    answer(error instanceof Error ? error : new Error(String(error)), "", 0);
    return;
  }
  if (addresses.some(({ address }) => isPrivateAddress(address))) {
    answer(new PrivateAddressError(host), "", 0);
    return;
  }
  const family = familyOf(options.family);
  const fitting = family === 0 ? addresses : addresses.filter((each) => each.family === family);
  const [first] = fitting;
  if (first === undefined) {
    answer(unresolved(host), "", 0);
  } else if (options.all === true) {
    answer(null, [...fitting]);
  } else {
    answer(null, first.address, first.family);
  }
};

// node's connect lookup over `resolve`
export const vettedLookup =
  (resolve: Resolve = resolveAll): LookupFunction =>
  (host, options, answer) => {
    void answerLookup(resolve, host, options, answer);
  };

// a dispatcher whose every connection is vetted by `resolve`
export const publicDispatcher = (resolve?: Resolve): Agent =>
  new Agent({ connect: { lookup: vettedLookup(resolve) } });
