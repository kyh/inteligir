import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { answerConnectPage, connectPageOrigin, readConnection } from "./connection";
import type { Connection } from "./connection";
import { CONNECTION } from "./test-support/fake-cloud";

beforeEach(() => {
  fakeBrowser.reset();
});

const { origin: _origin, ...MINTED } = CONNECTION;

const PAGE = { origin: "https://inteligir.com", url: "https://inteligir.com/connect/extension" };

describe("the page that may connect the extension", () => {
  it("is the production site's connect page exactly, in a store build", () => {
    expect(connectPageOrigin("store", PAGE)).toBe("https://inteligir.com");
    for (const sender of [
      { origin: "https://inteligir.com", url: "https://inteligir.com/library" },
      { origin: "https://evil.example", url: "https://evil.example/connect/extension" },
      {
        origin: "https://inteligir.com.evil.example",
        url: "https://inteligir.com.evil.example/connect/extension",
      },
      { origin: "http://localhost:5174", url: "http://localhost:5174/connect/extension" },
      // a sender whose page is not on the origin it claims
      { origin: "https://inteligir.com", url: "https://evil.example/connect/extension" },
      { url: "https://inteligir.com/connect/extension" },
    ]) {
      expect(connectPageOrigin("store", sender), JSON.stringify(sender)).toBeNull();
    }
  });

  it("is a local Worker's connect page on any port, in the dev build", () => {
    const local = {
      origin: "http://localhost:51234",
      url: "http://localhost:51234/connect/extension",
    };
    expect(connectPageOrigin("dev", local)).toBe("http://localhost:51234");
    expect(connectPageOrigin("dev", PAGE)).toBeNull();
    expect(
      connectPageOrigin("dev", {
        origin: "http://127.0.0.1:5174",
        url: "http://127.0.0.1:5174/connect/extension",
      }),
    ).toBeNull();
  });
});

describe("the connect page's messages", () => {
  const revoked: Connection[] = [];
  const deps = {
    revoke: async (connection: Connection) => {
      revoked.push(connection);
    },
  };
  const SITE = "https://inteligir.com";

  beforeEach(() => {
    revoked.length = 0;
  });

  it("answers whose library it saves to, and keeps a credential handed over with the page's origin as its cloud", async () => {
    await expect(answerConnectPage({ type: "hello" }, SITE, deps)).resolves.toStrictEqual({
      email: null,
    });
    await expect(
      answerConnectPage({ connection: MINTED, type: "connect" }, SITE, deps),
    ).resolves.toStrictEqual({
      email: MINTED.email,
    });
    const held = await readConnection();
    expect(held).toStrictEqual({ ...MINTED, origin: SITE });
    await expect(answerConnectPage({ type: "hello" }, SITE, deps)).resolves.toStrictEqual({
      email: MINTED.email,
    });
    expect(revoked).toStrictEqual([]);
  });

  it("revokes the credential a new connection replaces", async () => {
    await answerConnectPage({ connection: MINTED, type: "connect" }, SITE, deps);
    const next = { ...MINTED, credential: `igd_${"b".repeat(64)}`, deviceId: "next" };
    await answerConnectPage({ connection: next, type: "connect" }, SITE, deps);
    const held = await readConnection();
    expect(held?.deviceId).toBe("next");
    expect(revoked.map((connection) => connection.deviceId)).toStrictEqual([MINTED.deviceId]);
  });
});
