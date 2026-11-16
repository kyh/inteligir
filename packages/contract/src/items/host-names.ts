// what a host's spelling alone says about where it is, read with no lookup: a name every resolver
// that honours RFC 6761 answers with this very device, a name no public resolver answers, and an
// address written out. The cloud's fill refuses the first two before it asks for anything, and
// the extension, whose fetches have no lookup to vet, judges a page's claims by all three.

import { urlHost } from "./item-url";

export const isLoopbackName = (host: string): boolean => {
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

// URL writes an IPv4 address in any of its short forms (`192.168.1`, `0xc0.168.1.1`) as a dotted
// quad, and an IPv6 one in its brackets
const IPV4 = /^\d+\.\d+\.\d+\.\d+$/u;

const isAddressLiteral = (host: string): boolean => IPV4.test(host) || host.startsWith("[");

// whether a web address names a place off the public internet by its spelling alone: this device, a
// name no public resolver answers, or an address written out, which a public page has no cause to
// name. A name that resolves privately is not caught: only a lookup could tell
export const namesPrivateSpace = (url: string): boolean => {
  const host = urlHost(url);
  return host === null || isLoopbackName(host) || isPrivateUseName(host) || isAddressLiteral(host);
};
