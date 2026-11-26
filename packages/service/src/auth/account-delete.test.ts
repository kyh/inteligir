import { agentDeletedAccountSession } from "@repo/db/agent-schema";
import { session, user } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { dbSuite } from "@repo/db/test-database";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runAgentCron } from "../eve/agent-cron";
import { sendToAgent } from "../agent/agent-sessions";
import type { AgentRuntime } from "../agent/runtime";
import {
  createFakeAgentPlatform,
  fakeAgentRuntime,
} from "../test-support/fake-agent-platform.test-utils";
import type { FakeAgentPlatform } from "../test-support/fake-agent-platform.test-utils";

import {
  cookieHeaderOf,
  mintCode,
  mintSignInCode,
  readCode,
  sessionOf,
  signInPhone,
  signUp,
  signUpUser,
  userIdOf,
} from "../test-support/auth-requests.test-utils";
import { deleteAccountUnderSession } from "./delete-account";

const mailedCode = async (cookie: string) => {
  const signedIn = await sessionOf({ cookie });

  return signedIn === null ? "000000" : await mintSignInCode(signedIn.user.email);
};

const deleteUnder = async (
  cookie: string,
  accountId: string,
  { code, runtime = null }: { code?: string; runtime?: AgentRuntime | null } = {},
) =>
  await deleteAccountUnderSession(runtime, {
    accountId,
    code: code ?? (await mailedCode(cookie)),
    headers: new Headers({ cookie }),
  });

const userExists = async (userId: string) => {
  const rows = await db.select({ id: user.id }).from(user).where(eq(user.id, userId));

  return rows.length > 0;
};

const sessionsOf = async (userId: string) =>
  await db.select().from(session).where(eq(session.userId, userId));

const keptSessionsOf = async (accountId: string) => {
  const rows = await db
    .select({ eveSessionId: agentDeletedAccountSession.eveSessionId })
    .from(agentDeletedAccountSession)
    .where(eq(agentDeletedAccountSession.accountId, accountId));

  return rows.map(({ eveSessionId }) => eveSessionId);
};

dbSuite("deleting the account", () => {
  it("asks for a mailed code, and deletes the account and every session it held", async () => {
    const email = "delete-from-app@example.test";
    const { cookie } = await signUpUser(email);
    const laptop = await signInPhone(email);
    const phone = await signInPhone(email);
    const userId = await userIdOf(cookie);

    await expect(deleteUnder(laptop, userId)).resolves.toBe("deleted");

    await expect(userExists(userId)).resolves.toBe(false);

    for (const signedIn of [cookie, laptop, phone]) {
      await expect(sessionOf({ cookie: signedIn })).resolves.toBeNull();
    }

    await expect(sessionsOf(userId)).resolves.toStrictEqual([]);
  });

  it("keeps the invite spent, and forgets who spent it", async () => {
    await mintCode("INVITE-FORGOTTEN");

    const signedUp = await signUp({
      code: await mintSignInCode("Forgotten@Example.test"),
      email: "Forgotten@Example.test",
      inviteCode: "INVITE-FORGOTTEN",
      name: "Forgotten",
    });

    expect(signedUp.status).toBe(200);
    const cookie = cookieHeaderOf(signedUp);

    await expect(deleteUnder(cookie, await userIdOf(cookie))).resolves.toBe("deleted");

    const row = await readCode("INVITE-FORGOTTEN");
    expect(row?.redeemedBy).toBeNull();
    expect(row?.redeemedAt).not.toBeNull();
  });

  it("refuses a wrong code, and deletes nothing", async () => {
    const email = "delete-wrong-code@example.test";
    const { cookie } = await signUpUser(email);
    const phone = await signInPhone(email);
    const userId = await userIdOf(cookie);
    const mailed = await mintSignInCode(email);
    const wrong = mailed === "000000" ? "111111" : "000000";

    await expect(deleteUnder(phone, userId, { code: wrong })).resolves.toBe("invalid-credentials");

    await expect(userExists(userId)).resolves.toBe(true);
    await expect(sessionOf({ cookie: phone })).resolves.not.toBeNull();
    await expect(sessionsOf(userId)).resolves.toHaveLength(2);
  });

  it("answers signed-out for a session that has already ended", async () => {
    await expect(deleteUnder("nothing=here", "nobody")).resolves.toBe("signed-out");
  });

  describe("with conversations", () => {
    let platform: FakeAgentPlatform;
    let runtime: AgentRuntime;

    beforeEach(() => {
      platform = createFakeAgentPlatform();
      ({ runtime } = fakeAgentRuntime(platform));
    });

    const twoConversations = async (email: string) => {
      const { cookie } = await signUpUser(email);
      const accountId = await userIdOf(cookie);
      const sessions: string[] = [];

      for (const text of ["Hello", "Hi again"]) {
        const { threadId } = await sendToAgent(runtime, accountId, { text });
        sessions.push(platform.sessionFor(threadId, 1) ?? "");
      }

      await platform.turnsSettled();

      return { accountId, cookie, sessions };
    };

    it("ends the agent's session of every conversation as the account goes", async () => {
      const { accountId, cookie, sessions } = await twoConversations("delete-agent@example.test");

      await expect(deleteUnder(cookie, accountId, { runtime })).resolves.toBe("deleted");

      expect(sessions.map((id) => platform.session(id).ended)).toStrictEqual([true, true]);
      await expect(keptSessionsOf(accountId)).resolves.toStrictEqual([]);
    });

    it("leaves a session whose end fails to the agent's cron, which ends it", async () => {
      const { accountId, cookie, sessions } = await twoConversations(
        "delete-agent-away@example.test",
      );

      const [away = "", reached = ""] = sessions;

      const eveAway: AgentRuntime = {
        ...runtime,
        platform: {
          ...platform,
          end: async (caller, sessionId) => {
            if (sessionId === away) {
              throw new Error("eve is away");
            }

            return await platform.end(caller, sessionId);
          },
        },
      };

      const logged = vi.spyOn(console, "error");

      await expect(deleteUnder(cookie, accountId, { runtime: eveAway })).resolves.toBe("deleted");
      expect(logged).toHaveBeenCalledWith(
        expect.objectContaining({ event: "agent-session-end-failed" }),
      );
      logged.mockRestore();
      expect(platform.session(reached).ended).toBe(true);
      expect(platform.session(away).ended).toBe(false);
      await expect(keptSessionsOf(accountId)).resolves.toStrictEqual([away]);

      await expect(runAgentCron(runtime)).resolves.toMatchObject({
        sessions: { ended: 1, failed: 0, kept: 0 },
      });
      expect(platform.session(away).ended).toBe(true);
      await expect(keptSessionsOf(accountId)).resolves.toStrictEqual([]);
    });
  });
});
