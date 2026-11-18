// Deleting the account, the one way an account ends: the password asked again under a live
// session, and the account's row gone with every device's session and its agent's sessions. The
// `account.delete` call that reaches it is the /v1 router's, handing it the deployment's agent.

import { agentDeletedAccountSession } from "@repo/db/agent-schema";
import { session, user } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { dbSuite } from "@repo/db/test-database";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runAgentCron } from "../agent/agent-cron";
import { sendToAgent } from "../agent/agent-sessions";
import type { AgentRuntime } from "../agent/runtime";
import { createFakeAgentPlatform, fakeAgentRuntime } from "../test-support/fake-agent-platform";
import type { FakeAgentPlatform } from "../test-support/fake-agent-platform";

import {
  cookieHeaderOf,
  mintCode,
  PASSWORD,
  readCode,
  sessionOf,
  signInPhone,
  signUp,
  signUpUser,
  userIdOf,
} from "../test-support/auth-requests";
import { deleteAccountUnderSession } from "./delete-account";

// the account the cookie's session holds, deleted under it with no agent unless one is handed
const deleteUnder = async (
  cookie: string,
  accountId: string,
  {
    password = PASSWORD,
    runtime = null,
  }: { password?: string; runtime?: AgentRuntime | null } = {},
) =>
  await deleteAccountUnderSession(runtime, {
    accountId,
    headers: new Headers({ cookie }),
    password,
  });

const userExists = async (userId: string): Promise<boolean> => {
  const rows = await db.select({ id: user.id }).from(user).where(eq(user.id, userId));
  return rows.length > 0;
};

const sessionsOf = async (userId: string) =>
  await db.select().from(session).where(eq(session.userId, userId));

const keptSessionsOf = async (accountId: string): Promise<string[]> => {
  const rows = await db
    .select({ eveSessionId: agentDeletedAccountSession.eveSessionId })
    .from(agentDeletedAccountSession)
    .where(eq(agentDeletedAccountSession.accountId, accountId));
  return rows.map(({ eveSessionId }) => eveSessionId);
};

dbSuite("deleting the account", () => {
  it("re-checks the password, and deletes the account and every session it held", async () => {
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
      email: "Forgotten@Example.test",
      inviteCode: "INVITE-FORGOTTEN",
      name: "Forgotten",
      password: PASSWORD,
    });
    expect(signedUp.status).toBe(200);
    const cookie = cookieHeaderOf(signedUp);

    await expect(deleteUnder(cookie, await userIdOf(cookie))).resolves.toBe("deleted");

    const row = await readCode("INVITE-FORGOTTEN");
    expect(row?.redeemedBy).toBeNull();
    expect(row?.redeemedAt).not.toBeNull();
  });

  it("refuses a wrong password, and deletes nothing", async () => {
    const email = "delete-wrong-password@example.test";
    const { cookie } = await signUpUser(email);
    const phone = await signInPhone(email);
    const userId = await userIdOf(cookie);

    await expect(deleteUnder(phone, userId, { password: "not-the-password" })).resolves.toBe(
      "invalid-credentials",
    );

    await expect(userExists(userId)).resolves.toBe(true);
    await expect(sessionOf({ cookie: phone })).resolves.not.toBeNull();
    // the sign-up's own session, which the test holds as its cookie, and the phone's
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

    // a day allows an account two turns, each starting a conversation's eve session
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
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});

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
