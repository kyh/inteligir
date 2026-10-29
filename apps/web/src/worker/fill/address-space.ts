// Where an address written out as a URL's host sits, read from the spelling the WHATWG parser gives
// it, which folds every other spelling of an address into one: an IPv4 address's decimal, octal, hex
// and short forms into its dotted quad, an IPv6 address into its compressed lowercase groups, an
// IPv4 address inside one into two hex groups. An address is `private` where the public internet
// cannot reach it on anyone's behalf (this machine, a home's or an office's network, a carrier's
// shared space, link-local space and the cloud metadata services in it), `reserved` where no host
// may hold it (documentation, benchmarking, multicast and the other special-purpose blocks IANA
// lists as not globally reachable), and `public` otherwise. A name is no address: null.

export type AddressSpace = "public" | "private" | "reserved";

interface Block {
  // the block's first address, as a number
  readonly base: number;
  readonly bits: number;
  readonly space: Exclude<AddressSpace, "public">;
}

const IPV4 = /^(?<a>\d{1,3})\.(?<b>\d{1,3})\.(?<c>\d{1,3})\.(?<d>\d{1,3})$/u;

const ipv4Value = (address: string): number | null => {
  const groups = IPV4.exec(address)?.groups;
  if (groups === undefined) {
    return null;
  }
  const octets = [groups["a"], groups["b"], groups["c"], groups["d"]].map(Number);
  return octets.every((octet) => octet <= 255)
    ? octets.reduce((value, octet) => value * 256 + octet, 0)
    : null;
};

const block = (spec: string, space: Block["space"]): Block => {
  const [address = "", bits = "32"] = spec.split("/");
  return { base: ipv4Value(address) ?? 0, bits: Number(bits), space };
};

// RFC 6890's registry, the blocks no public route reaches or no host holds
const IPV4_BLOCKS: readonly Block[] = [
  block("0.0.0.0/8", "private"),
  block("10.0.0.0/8", "private"),
  block("100.64.0.0/10", "private"),
  block("127.0.0.0/8", "private"),
  block("169.254.0.0/16", "private"),
  block("172.16.0.0/12", "private"),
  block("192.168.0.0/16", "private"),
  block("192.0.0.0/24", "reserved"),
  block("192.0.2.0/24", "reserved"),
  block("198.18.0.0/15", "reserved"),
  block("198.51.100.0/24", "reserved"),
  block("203.0.113.0/24", "reserved"),
  block("224.0.0.0/4", "reserved"),
  block("240.0.0.0/4", "reserved"),
];

const ipv4Space = (value: number): AddressSpace => {
  const held = IPV4_BLOCKS.find((range) => {
    const size = 2 ** (32 - range.bits);
    return Math.floor(value / size) === Math.floor(range.base / size);
  });
  return held?.space ?? "public";
};

const HEX_GROUP = /^[\da-f]{1,4}$/u;

const groupsOf = (part: string | undefined): string[] =>
  part === undefined || part === "" ? [] : part.split(":");

// the eight 16-bit groups of an address the parser wrote, or null for a spelling it never writes
const ipv6Groups = (address: string): number[] | null => {
  const halves = address.split("::");
  if (halves.length > 2) {
    return null;
  }
  const head = groupsOf(halves[0]);
  const tail = groupsOf(halves[1]);
  if (![...head, ...tail].every((group) => HEX_GROUP.test(group))) {
    return null;
  }
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) {
    return null;
  }
  return [
    ...head,
    ...Array.from({ length: halves.length === 1 ? 0 : missing }, () => "0"),
    ...tail,
  ].map((group) => Number.parseInt(group, 16));
};

const zeroBefore = (groups: readonly number[], end: number): boolean =>
  groups.slice(0, end).every((group) => group === 0);

const at = (groups: readonly number[], index: number): number => groups[index] ?? 0;

// the IPv4 address an IPv6 one carries where a host or a translator reads it as that address:
// mapped (::ffff:a.b.c.d), translated (::ffff:0:a.b.c.d), compatible (::a.b.c.d) and the
// well-known NAT64 prefix (64:ff9b::a.b.c.d)
const carriedIpv4 = (groups: readonly number[]): number | null => {
  const last = at(groups, 6) * 65_536 + at(groups, 7);
  const mapped = zeroBefore(groups, 5) && at(groups, 5) === 0xff_ff;
  const translated = zeroBefore(groups, 4) && at(groups, 4) === 0xff_ff && at(groups, 5) === 0;
  const compatible = zeroBefore(groups, 6) && last > 1;
  const nat64 =
    at(groups, 0) === 0x64 && at(groups, 1) === 0xff_9b && zeroBefore(groups.slice(2), 4);
  return mapped || translated || compatible || nat64 ? last : null;
};

const ipv6Space = (groups: readonly number[]): AddressSpace => {
  const carried = carriedIpv4(groups);
  if (carried !== null) {
    return ipv4Space(carried);
  }
  const first = at(groups, 0);
  // :: and ::1, this machine; fe80::/10 link-local; fc00::/7 unique local, the cloud's metadata
  // addresses among them; fec0::/10, the retired site-local space, just as internal
  if (zeroBefore(groups, 7) && at(groups, 7) <= 1) {
    return "private";
  }
  if (first >= 0xfe_80 || (first >= 0xfc_00 && first <= 0xfd_ff)) {
    return first >= 0xff_00 ? "reserved" : "private";
  }
  // 2001:db8::/32, documentation; 100::/64, discard only
  if (
    (first === 0x20_01 && at(groups, 1) === 0x0d_b8) ||
    (first === 0x01_00 && zeroBefore(groups.slice(1), 3))
  ) {
    return "reserved";
  }
  return "public";
};

// the space of a host the WHATWG parser wrote (`new URL(…).hostname`), or null when it is a name;
// an IPv6 host comes in its brackets, and a spelling the parser never writes is reserved, so it is
// never asked
export const addressSpace = (hostname: string): AddressSpace | null => {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    const groups = ipv6Groups(hostname.slice(1, -1));
    return groups === null ? "reserved" : ipv6Space(groups);
  }
  const value = ipv4Value(hostname);
  if (value !== null) {
    return ipv4Space(value);
  }
  return /^[\d.]+$/u.test(hostname) ? "reserved" : null;
};
