import { urlHost } from "./item-url";

export const isLoopbackName = (host: string) => {
  const name = host.toLowerCase().replace(/\.$/u, "");

  return name === "localhost" || name.endsWith(".localhost");
};

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

export const isPrivateUseName = (host: string) => {
  const name = host.toLowerCase().replace(/\.$/u, "");

  return (
    !name.includes(".") ||
    PRIVATE_USE_SUFFIXES.some((suffix) => name === suffix || name.endsWith(`.${suffix}`))
  );
};

const IPV4 = /^\d+\.\d+\.\d+\.\d+$/u;

export const isAddressLiteral = (host: string) => IPV4.test(host) || host.startsWith("[");

export const namesPrivateSpace = (url: string) => {
  const host = urlHost(url);

  return host === null || isLoopbackName(host) || isPrivateUseName(host) || isAddressLiteral(host);
};
