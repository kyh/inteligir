import { EXTENSION_ID } from "@repo/contract/cloud/extension/extension-identity";
import type { ExtensionConnectRequest } from "@repo/contract/cloud/extension/extension-connect";
import { describe, expect, it } from "vitest";

import { askExtension, connectExtension } from "./extension-connect";
import type { ConnectPorts } from "./extension-connect";

const MINTED = {
  credential: `igd_${"a".repeat(64)}`,
  deviceId: "device-1",
  email: "reader@example.test",
  userId: "user-1",
};

// an extension that answers as the case scripts, and what the page asked of the cloud: the email
// it is connected as, null for none, or "absent" for no extension at all
const portsWith = (answer: (request: ExtensionConnectRequest) => string | null) => {
  const asked: ExtensionConnectRequest[] = [];
  const revoked: string[] = [];
  let minted = 0;
  const ports: ConnectPorts = {
    ask: async (request) => {
      asked.push(request);
      const email = answer(request);
      return email === "absent" ? null : { email };
    },
    mint: async () => {
      minted += 1;
      return MINTED;
    },
    revoke: async (credential) => {
      revoked.push(credential);
    },
  };
  return { asked, minted: () => minted, ports, revoked };
};

describe("connecting the browser extension", () => {
  it("hands the extension the credential minted for the account, and says whose library it saves to", async () => {
    const run = portsWith((request) => (request.type === "connect" ? MINTED.email : null));
    await expect(connectExtension(run.ports)).resolves.toStrictEqual({
      email: MINTED.email,
      kind: "connected",
    });
    expect(run.asked).toStrictEqual([{ type: "hello" }, { connection: MINTED, type: "connect" }]);
    expect(run.revoked).toStrictEqual([]);
  });

  it("mints nothing when no extension is in this browser", async () => {
    const run = portsWith(() => "absent");
    await expect(connectExtension(run.ports)).resolves.toStrictEqual({ kind: "no-extension" });
    expect(run.minted()).toBe(0);
  });

  it("revokes the credential an extension did not take, so no device is left that nothing holds", async () => {
    const run = portsWith((request) => (request.type === "hello" ? null : "absent"));
    await expect(connectExtension(run.ports)).resolves.toStrictEqual({ kind: "not-taken" });
    expect(run.revoked).toStrictEqual([MINTED.credential]);
  });
});

describe("a message to the extension", () => {
  it("goes to the committed id alone, and reads only an answer that is one", async () => {
    const sent: unknown[][] = [];
    const answer = await askExtension(
      {
        sendMessage: async (...args) => {
          sent.push(args);
          return { email: MINTED.email, extra: true };
        },
      },
      { type: "hello" },
    );
    expect(answer).toStrictEqual({ email: MINTED.email });
    expect(sent).toStrictEqual([[EXTENSION_ID, { type: "hello" }]]);
    await expect(
      askExtension({ sendMessage: async () => "nonsense" }, { type: "hello" }),
    ).resolves.toBeNull();
    await expect(
      askExtension(
        {
          sendMessage: async () => {
            throw new Error("Could not establish connection. Receiving end does not exist.");
          },
        },
        { type: "hello" },
      ),
    ).resolves.toBeNull();
    // a browser holding no extension that names this page has no runtime to ask
    const noExtension: Window["chrome"] = {};
    await expect(askExtension(noExtension.runtime, { type: "hello" })).resolves.toBeNull();
  });
});
