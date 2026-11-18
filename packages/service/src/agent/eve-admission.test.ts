import { randomUUID } from "node:crypto";

import { dbSuite } from "@repo/db/test-database";
import { expect, it } from "vitest";

import { createFakeAgentPlatform, fakeAgentRuntime } from "../test-support/fake-agent-platform";
import { personalLibrary } from "../test-support/library-fixture";
import { deleteAgentThread, sendToAgent } from "./agent-sessions";
import { admitEveRequest, eveCallerOf } from "./eve-admission";
import { recordEveFact } from "./eve-agent";
import { eveOperationId, mintEveToken } from "./eve-token";

const threadOfOwn = async () => {
  const { accountId } = await personalLibrary();
  const platform = createFakeAgentPlatform(recordEveFact);
  const { runtime, settled } = fakeAgentRuntime(platform);
  const { threadId } = await sendToAgent(runtime, accountId, { text: "Hello" });
  await platform.turnsSettled();
  return { accountId, runtime, settled, threadId };
};

dbSuite("the agent's channel admission", () => {
  it("opens a session's own routes to its token, as its thread's account", async () => {
    const { accountId, threadId } = await threadOfOwn();
    const token = await mintEveToken({
      accountId,
      eveSessionId: "sess_A",
      eveSessionNumber: 1,
      threadId,
    });
    const admitted = await admitEveRequest({
      method: "POST",
      operationId: null,
      pathname: "/eve/v1/session/sess_A",
      token,
    });
    expect(admitted.ok).toBe(true);
    expect(admitted.ok && eveCallerOf(admitted.principal)).toStrictEqual({
      accountId,
      eveSessionNumber: 1,
      threadId,
    });
    for (const pathname of ["/eve/v1/session/sess_B", "/eve/v1/session/sess_A/clear"]) {
      await expect(
        admitEveRequest({ method: "POST", operationId: null, pathname, token }),
      ).resolves.toMatchObject({ ok: false, status: 403 });
    }
  });

  it("starts a session only under its thread's operation id", async () => {
    const { accountId, threadId } = await threadOfOwn();
    const token = await mintEveToken({
      accountId,
      eveSessionId: null,
      eveSessionNumber: 2,
      threadId,
    });
    const create = { method: "POST", pathname: "/eve/v1/session", token };
    await expect(
      admitEveRequest({ ...create, operationId: eveOperationId(threadId, 2) }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      admitEveRequest({ ...create, operationId: eveOperationId(threadId, 3) }),
    ).resolves.toMatchObject({ ok: false, status: 403 });
  });

  it("refuses no token, a forged one, and a deleted thread's but to stop it", async () => {
    const { accountId, runtime, settled, threadId } = await threadOfOwn();
    const request = { method: "POST", operationId: null, pathname: "/eve/v1/session/sess_A" };
    await expect(admitEveRequest({ ...request, token: null })).resolves.toMatchObject({
      status: 401,
    });
    await expect(admitEveRequest({ ...request, token: "forged" })).resolves.toMatchObject({
      status: 401,
    });
    const token = await mintEveToken({
      accountId,
      eveSessionId: "sess_A",
      eveSessionNumber: 1,
      threadId,
    });
    await deleteAgentThread(runtime, accountId, threadId);
    await settled();
    await expect(admitEveRequest({ ...request, token })).resolves.toMatchObject({ status: 403 });
    await expect(
      admitEveRequest({ ...request, pathname: "/eve/v1/session/sess_A/cancel", token }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      admitEveRequest({
        ...request,
        token: await mintEveToken({
          accountId: randomUUID(),
          eveSessionId: "sess_A",
          eveSessionNumber: 1,
          threadId,
        }),
      }),
    ).resolves.toMatchObject({ status: 403 });
  });
});
