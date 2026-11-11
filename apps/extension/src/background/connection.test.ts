import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { answerConnectPage, connectPageOrigin } from "./connection";
import type { SignIn } from "./sign-in";
import { SESSION, SIGNED_IN, SIGNED_OUT } from "./test-support/fake-cloud";

beforeEach(() => {
  fakeBrowser.reset();
});

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
  const SITE = "https://inteligir.com";
  const asked: string[] = [];
  const answering = (signIn: SignIn | null) => ({
    signIn: async (origin: string) => {
      asked.push(origin);
      return signIn;
    },
  });

  beforeEach(() => {
    asked.length = 0;
  });

  it("answer the account the browser is signed in as on the page's own site", async () => {
    await expect(answerConnectPage(SITE, answering(SIGNED_IN))).resolves.toStrictEqual({
      email: SESSION.email,
    });
    expect(asked).toStrictEqual([SITE]);
  });

  it("name no account when the browser is signed out there, or the cloud did not answer", async () => {
    const none: SignIn = { kind: "none" };
    for (const signIn of [SIGNED_OUT, none, null]) {
      await expect(answerConnectPage(SITE, answering(signIn))).resolves.toStrictEqual({
        email: null,
      });
    }
  });
});
