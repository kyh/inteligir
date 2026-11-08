import { EXTENSION_ID } from "@repo/contract/cloud/extension/extension-identity";
import type { JsonValue } from "@repo/notes/library/canonical-json";
import { describe, expect, it } from "vitest";

import { connectExtension } from "./extension-connect";

const EMAIL = "reader@example.test";

// an extension that answers as the case scripts, and every message the page sent it
const extensionAnswering = (answer: () => JsonValue) => {
  const sent: unknown[][] = [];
  return {
    runtime: {
      sendMessage: async (...args: unknown[]) => {
        sent.push(args);
        return await Promise.resolve(answer());
      },
    },
    sent,
  };
};

describe("connecting the browser extension", () => {
  it("names this page to the committed id alone, with no credential, and says whose library it saves to", async () => {
    const extension = extensionAnswering(() => ({ email: EMAIL, extra: true }));
    await expect(connectExtension(extension.runtime)).resolves.toStrictEqual({
      email: EMAIL,
      kind: "connected",
    });
    expect(extension.sent).toStrictEqual([[EXTENSION_ID, { type: "connect" }]]);
  });

  it("says when the extension found this browser signed in to no account", async () => {
    const extension = extensionAnswering(() => ({ email: null }));
    await expect(connectExtension(extension.runtime)).resolves.toStrictEqual({
      kind: "no-sign-in",
    });
  });

  it("reads no extension where none answers, or an answer that is not one", async () => {
    // a browser holding no extension that names this page has no runtime to ask
    const noExtension: Window["chrome"] = {};
    await expect(connectExtension(noExtension.runtime)).resolves.toStrictEqual({
      kind: "no-extension",
    });
    const nonsense = extensionAnswering(() => "nonsense");
    await expect(connectExtension(nonsense.runtime)).resolves.toStrictEqual({
      kind: "no-extension",
    });
    const refused = extensionAnswering(() => {
      throw new Error("Could not establish connection. Receiving end does not exist.");
    });
    await expect(connectExtension(refused.runtime)).resolves.toStrictEqual({
      kind: "no-extension",
    });
  });
});
