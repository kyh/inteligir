// where a save may send the Mac: every address a fetch would dial is classified here, from an IP
// literal before any dial and from every address a lookup answers. An IPv6 address that carries an
// IPv4 one (mapped, compatible, translated, NAT64, 6to4, Teredo) is judged as that IPv4 address,
// because a dual-stack socket reaches it through any of those spellings. Pure: no lookup, no dial.

import { isIP } from "node:net";

export type AddressClass = "this-mac" | "link-local" | "reserved" | "private" | "public";

// the policy a suite injects (CapturePorts.policy): the guard's own classification by default
export type AddressPolicy = (address: string) => AddressClass;

// what a fetch whose saved address is `reach` may dial: private space only from private space
export type Reach = "public" | "private";

export type GuardRefusal =
  // an address of this Mac, `localhost`, or the server's own port
  | "this-mac"
  | "link-local"
  // reserved space, or an answer mixing private and public addresses
  | "reserved"
  // a public saved address led to private space (a redirect, a cover, a stylesheet)
  | "private-from-public";

export type AnswerVerdict = { ok: true; reach: Reach } | { ok: false; refusal: GuardRefusal };

// most restrictive first: an answer is refused by its worst address
const SEVERITY: readonly AddressClass[] = [
  "this-mac",
  "link-local",
  "reserved",
  "private",
  "public",
];

const worst = (classes: readonly AddressClass[]): AddressClass =>
  SEVERITY.find((candidate) => classes.includes(candidate)) ?? "public";

interface Cidr4 {
  base: number;
  bits: number;
  of: AddressClass;
}

const ipv4Number = (address: string): number => {
  const parts = address.split(".").map(Number);
  return parts.reduce((total, part) => total * 256 + part, 0);
};

const cidr4 = (spec: string, of: AddressClass): Cidr4 => {
  const [base = "", bits = "32"] = spec.split("/");
  return { base: ipv4Number(base), bits: Number(bits), of };
};

const IPV4_RANGES: readonly Cidr4[] = [
  cidr4("0.0.0.0/8", "this-mac"),
  cidr4("127.0.0.0/8", "this-mac"),
  cidr4("169.254.0.0/16", "link-local"),
  cidr4("224.0.0.0/4", "reserved"),
  cidr4("240.0.0.0/4", "reserved"),
  cidr4("192.0.0.0/24", "reserved"),
  cidr4("192.0.2.0/24", "reserved"),
  cidr4("198.18.0.0/15", "reserved"),
  cidr4("198.51.100.0/24", "reserved"),
  cidr4("203.0.113.0/24", "reserved"),
  cidr4("10.0.0.0/8", "private"),
  cidr4("172.16.0.0/12", "private"),
  cidr4("192.168.0.0/16", "private"),
  cidr4("100.64.0.0/10", "private"),
];

const inCidr4 = (value: number, range: Cidr4): boolean => {
  const size = 2 ** (32 - range.bits);
  return Math.floor(value / size) === Math.floor(range.base / size);
};

const classifyIpv4Number = (value: number): AddressClass =>
  worst(IPV4_RANGES.filter((range) => inCidr4(value, range)).map((range) => range.of));

const parseGroups = (part: string): number[] =>
  part === "" ? [] : part.split(":").map((group) => Number.parseInt(group, 16));

// eight 16-bit groups; a trailing dotted quad is two groups
const ipv6Groups = (address: string): number[] | null => {
  let text = address;
  const tail: number[] = [];
  const quad = /(?<quad>\d{1,3}(?:\.\d{1,3}){3})$/u.exec(text)?.groups?.quad;
  if (quad !== undefined) {
    const value = ipv4Number(quad);
    tail.push(Math.floor(value / 65_536), value % 65_536);
    text = text.slice(0, -quad.length);
    if (text.endsWith(":") && !text.endsWith("::")) {
      text = text.slice(0, -1);
    }
  }
  const [head = "", rest] = text.split("::");
  const front = parseGroups(head);
  const back = [...(rest === undefined ? [] : parseGroups(rest)), ...tail];
  if (rest === undefined) {
    const groups = [...front, ...back];
    return groups.length === 8 ? groups : null;
  }
  const fill = 8 - front.length - back.length;
  return fill < 0 ? null : [...front, ...Array.from({ length: fill }, () => 0), ...back];
};

const joinGroups = (high: number, low: number): number => high * 65_536 + low;

const groupAt = (g: readonly number[], index: number): number => g[index] ?? 0;

const lastIpv4 = (g: readonly number[]): number => joinGroups(groupAt(g, 6), groupAt(g, 7));

const zeroThrough = (g: readonly number[], end: number): boolean =>
  g.slice(0, end).every((value) => value === 0);

// the local-use NAT64 prefix's two layouts (see EMBEDDINGS)
const localUseNat64 = (g: readonly number[]): number[] => {
  const layout48 = g.slice(3, 6).every((value) => value === 0)
    ? []
    : [joinGroups(groupAt(g, 3), (groupAt(g, 4) % 256) * 256 + Math.floor(groupAt(g, 5) / 256))];
  const tail = lastIpv4(g) !== 0 || layout48.length === 0 ? [lastIpv4(g)] : [];
  return [...tail, ...layout48];
};

// one transition spelling: whether the IPv6 address is in its prefix, and the IPv4 addresses it
// carries there
interface Embedding {
  matches: (g: readonly number[]) => boolean;
  carried: (g: readonly number[]) => number[];
}

const EMBEDDINGS: readonly Embedding[] = [
  // ::ffff:a.b.c.d (mapped)
  {
    carried: (g) => [lastIpv4(g)],
    matches: (g) => zeroThrough(g, 5) && groupAt(g, 5) === 0xff_ff,
  },
  // ::a.b.c.d (compatible; :: and ::1 are this Mac's own spellings)
  {
    carried: (g) => [lastIpv4(g)],
    matches: (g) => zeroThrough(g, 6) && lastIpv4(g) > 1,
  },
  // ::ffff:0:a.b.c.d (translated)
  {
    carried: (g) => [lastIpv4(g)],
    matches: (g) => zeroThrough(g, 4) && groupAt(g, 4) === 0xff_ff && groupAt(g, 5) === 0,
  },
  // 64:ff9b::/96, the well-known NAT64 prefix
  {
    carried: (g) => [lastIpv4(g)],
    matches: (g) =>
      groupAt(g, 0) === 0x64 && groupAt(g, 1) === 0xff_9b && zeroThrough(g.slice(2), 4),
  },
  // 64:ff9b:1::/48, the local-use NAT64 prefix: a /96 under it carries the address last, and the
  // RFC 6052 /48 layout carries it in bits 48-63 and 72-87, around the u octet. Each is read only
  // when its bits hold anything, so one layout's zeros are never judged as 0.0.0.0
  {
    carried: localUseNat64,
    matches: (g) => groupAt(g, 0) === 0x64 && groupAt(g, 1) === 0xff_9b && groupAt(g, 2) === 1,
  },
  // 2002::/16, 6to4: bits 16 to 47
  {
    carried: (g) => [joinGroups(groupAt(g, 1), groupAt(g, 2))],
    matches: (g) => groupAt(g, 0) === 0x20_02,
  },
  // 2001::/32, Teredo: the client's address, inverted, in the last 32 bits
  {
    carried: (g) => [0xff_ff_ff_ff - lastIpv4(g)],
    matches: (g) => groupAt(g, 0) === 0x20_01 && groupAt(g, 1) === 0,
  },
];

// every IPv4 address the IPv6 one could carry, by the spellings a dual-stack host or a translator
// reads
const embeddedIpv4 = (g: readonly number[]): number[] =>
  EMBEDDINGS.filter((embedding) => embedding.matches(g)).flatMap((embedding) =>
    embedding.carried(g),
  );

const classifyIpv6Itself = (g: readonly number[]): AddressClass => {
  const [g0 = 0, g1 = 0] = g;
  if (zeroThrough(g, 8)) {
    return "this-mac";
  }
  if (zeroThrough(g, 7) && g[7] === 1) {
    return "this-mac";
  }
  if (g0 >= 0xfe_80 && g0 <= 0xfe_bf) {
    return "link-local";
  }
  if (g0 >= 0xff_00) {
    return "reserved";
  }
  if (g0 === 0x20_01 && g1 === 0x0d_b8) {
    return "reserved";
  }
  // fc00::/7, unique local; fec0::/10, the deprecated site-local space, is just as internal
  if ((g0 >= 0xfc_00 && g0 <= 0xfd_ff) || (g0 >= 0xfe_c0 && g0 <= 0xfe_ff)) {
    return "private";
  }
  return "public";
};

// an address this guard cannot read is refused as reserved, never let through
export const classifyAddress: AddressPolicy = (raw) => {
  const address = raw.replaceAll(/^\[|\]$/gu, "").replace(/%.*$/u, "");
  const family = isIP(address);
  if (family === 4) {
    return classifyIpv4Number(ipv4Number(address));
  }
  if (family !== 6) {
    return "reserved";
  }
  const groups = ipv6Groups(address.toLowerCase());
  if (groups === null || groups.some((value) => Number.isNaN(value))) {
    return "reserved";
  }
  return worst([classifyIpv6Itself(groups), ...embeddedIpv4(groups).map(classifyIpv4Number)]);
};

// one spelling per address, so two spellings of one compare equal: an IPv4 address as its number,
// an IPv6 one as its eight groups; null for anything that is not an address
export const addressKey = (raw: string): string | null => {
  const address = raw.replaceAll(/^\[|\]$/gu, "").replace(/%.*$/u, "");
  const family = isIP(address);
  if (family === 4) {
    return `4:${String(ipv4Number(address))}`;
  }
  if (family !== 6) {
    return null;
  }
  const groups = ipv6Groups(address.toLowerCase());
  return groups === null || groups.some((value) => Number.isNaN(value))
    ? null
    : `6:${groups.join(":")}`;
};

// the address's own key and the key of every IPv4 address it carries (see EMBEDDINGS), the ways a
// dual-stack socket could reach one address under another spelling
export const reachedKeys = (raw: string): string[] => {
  const own = addressKey(raw);
  if (own === null) {
    return [];
  }
  const address = raw.replaceAll(/^\[|\]$/gu, "").replace(/%.*$/u, "");
  const groups = isIP(address) === 6 ? ipv6Groups(address.toLowerCase()) : null;
  const carried = groups === null ? [] : embeddedIpv4(groups).map((value) => `4:${String(value)}`);
  return [own, ...carried];
};

// refused before any lookup: the name resolves to this Mac on every resolver that honours RFC 6761
export const isThisMacName = (host: string): boolean => {
  const name = host.toLowerCase().replace(/\.$/u, "");
  return name === "localhost" || name.endsWith(".localhost");
};

// a name no public resolver answers, so no stranger chooses what it resolves to: one label (`nas`,
// `wiki`), a suffix set aside for a home or an office (`.local`, `.home.arpa`, `.internal`), or one
// the root has never delegated because homes and offices use it (`.lan`, `.home`, `.corp`, …)
const PRIVATE_USE_SUFFIXES = [
  "local",
  "home.arpa",
  "internal",
  "lan",
  "home",
  "corp",
  "intranet",
  "localdomain",
];

export const isPrivateUseName = (host: string): boolean => {
  const name = host.toLowerCase().replace(/\.$/u, "");
  return (
    !name.includes(".") ||
    PRIVATE_USE_SUFFIXES.some((suffix) => name === suffix || name.endsWith(`.${suffix}`))
  );
};

// one hop's whole answer. `reach` null: the saved address itself, whose answer decides the reach
// every later hop and subresource gets
export const vetAnswer = (classes: readonly AddressClass[], reach: Reach | null): AnswerVerdict => {
  if (classes.length === 0) {
    return { ok: false, refusal: "reserved" };
  }
  const judged = worst(classes);
  if (judged === "this-mac" || judged === "link-local" || judged === "reserved") {
    return { ok: false, refusal: judged };
  }
  const hasPublic = classes.includes("public");
  const hasPrivate = classes.includes("private");
  if (reach === null) {
    if (hasPublic && hasPrivate) {
      return { ok: false, refusal: "reserved" };
    }
    return { ok: true, reach: hasPrivate ? "private" : "public" };
  }
  if (reach === "public" && hasPrivate) {
    return { ok: false, refusal: "private-from-public" };
  }
  if (hasPublic && hasPrivate) {
    return { ok: false, refusal: "reserved" };
  }
  return { ok: true, reach };
};
