import type { LookupOptions } from "node:dns";
import { once } from "node:events";
import { createServer } from "node:http";
import { promisify } from "node:util";

import { fetch as undiciFetch } from "undici";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { dispatchedFetch, pageFetch } from "./page-fetch";
import {
  isPrivateAddress,
  PrivateAddressError,
  publicDispatcher,
  vettedLookup,
} from "./public-dispatcher";

const answering =
  (...addresses: readonly string[]) =>
  async () =>
    await Promise.resolve(
      addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
    );

const lookUp = async (addresses: readonly string[], options: LookupOptions = {}) =>
  await promisify(vettedLookup(answering(...addresses)))("pages.example", options);

describe("an address a name resolves to", () => {
  it.each([
    "10.0.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.4.2",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "fd00::1",
    "fec0::1",
    "fe80::1%en0",
    "not an address",
  ])("refuses %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "2606:4700:4700::1111", "::ffff:93.184.216.34"])(
    "passes %s",
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );
});

describe("the vetted lookup", () => {
  it.each([["10.0.0.1"], ["::ffff:127.0.0.1"], ["169.254.169.254"]])(
    "refuses a name answered with %s",
    async (address) => {
      await expect(lookUp([address])).rejects.toBeInstanceOf(PrivateAddressError);
    },
  );

  it("refuses a name whose answer mixes a public address with a private one", async () => {
    await expect(lookUp(["93.184.216.34", "10.0.0.1"], { all: true })).rejects.toBeInstanceOf(
      PrivateAddressError,
    );
  });

  it("hands a public answer to the connect as it asked: every address, or the first", async () => {
    const both = ["93.184.216.34", "2606:4700::6810:84e5"];
    await expect(lookUp(both, { all: true })).resolves.toStrictEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700::6810:84e5", family: 6 },
    ]);
    await expect(lookUp(both)).resolves.toBe("93.184.216.34");
    await expect(lookUp(both, { family: 6 })).resolves.toBe("2606:4700::6810:84e5");
  });
});

describe("the dispatcher", () => {
  const closing: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const close of closing.splice(0)) {
      await close();
    }
  });

  const loopbackServer = async () => {
    const server = createServer((_request, response) => {
      response.end("inside");
    });

    let connections = 0;
    server.on("connection", () => {
      connections += 1;
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    closing.push(async () => {
      server.close();
      await once(server, "close");
    });
    const { port } = z.object({ port: z.number() }).parse(server.address());

    return { connections: () => connections, port };
  };

  it("never connects to a server on this machine reached by a public-looking name", async () => {
    const server = await loopbackServer();
    const dispatcher = publicDispatcher(answering("127.0.0.1"));
    closing.push(async () => {
      await dispatcher.close();
    });
    await expect(
      undiciFetch(`http://pages.example:${String(server.port)}/`, { dispatcher }),
    ).rejects.toHaveProperty("cause", expect.any(PrivateAddressError));
    expect(server.connections()).toBe(0);
    const reached = await undiciFetch(`http://127.0.0.1:${String(server.port)}/`);
    await expect(reached.text()).resolves.toBe("inside");
    expect(server.connections()).toBe(1);
  });

  it("is said by the read as a private network, with no try again", async () => {
    const dispatcher = publicDispatcher(answering("93.184.216.34", "127.0.0.1"));
    closing.push(async () => {
      await dispatcher.close();
    });
    const read = pageFetch({ deadlineMs: 20_000, fetch: dispatchedFetch(dispatcher) });
    await expect(
      read({
        accept: "text/html",
        maxBytes: 1024,
        overflow: "truncate",
        url: "https://pages.example/",
      }),
    ).resolves.toStrictEqual({
      failure: { kind: "refused", refusal: "private-network" },
      ok: false,
    });
  });
});
