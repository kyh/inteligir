import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@repo/contract/device/device-schema";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { doorAt } from "./door-routes";
import { sendResetEmail } from "./auth/reset-email";
import { createDb } from "@repo/db/d1/client";
import { verification } from "@repo/db/d1/schema";
import { drained, ORIGIN, signUpUser } from "./test-support/cloud-helpers";
import {
  answerToReset,
  envWith,
  extractResetLink,
  firstEmail,
  followGetLeg,
  issueToken,
  recordingEmail,
  requestReset,
  RESET_PAGE_PATH,
  SENDER,
} from "./test-support/password-reset";

// the new password every reset here sets
const NEW_PASSWORD = "new-password-5678";

const signIn = async (email: string, password: string): Promise<Response> =>
  await exports.default.fetch(`${ORIGIN}/api/auth/sign-in/email`, {
    body: JSON.stringify({ email, password }),
    headers: { "content-type": "application/json", origin: ORIGIN },
    method: "POST",
  });

describe("password reset", () => {
  it("a known email gets ONE reset email carrying the URL, from the configured sender", async () => {
    await signUpUser("known@example.com");
    const { EMAIL, sent } = recordingEmail();

    const response = await requestReset("known@example.com", envWith(EMAIL));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: true });

    expect(sent).toHaveLength(1);
    const [message] = sent;
    if (message === undefined) {
      throw new Error("unreachable");
    }
    expect(message.to).toBe("known@example.com");
    expect(message.from).toStrictEqual({ email: SENDER, name: "inteligir" });
    expect(message.subject).toBe("Reset your inteligir password");
    const link = extractResetLink(message);
    expect(link).toContain(`${ORIGIN}/api/auth/reset-password/`);
    expect(link).toContain(`callbackURL=${encodeURIComponent(RESET_PAGE_PATH)}`);
    expect(message.html).toContain(link);
  });

  it("an UNKNOWN email gets the byte-identical neutral response and NO email", async () => {
    await signUpUser("oracle-probe@example.com");
    const { EMAIL, sent } = recordingEmail();
    const testEnv = envWith(EMAIL);

    const known = await requestReset("oracle-probe@example.com", testEnv);
    const knownBody = await known.text();
    expect(sent).toHaveLength(1);

    const unknown = await requestReset("nobody-ever-signed-up@example.com", testEnv);
    expect(unknown.status).toBe(known.status);
    await expect(unknown.text()).resolves.toBe(knownBody);
    expect(sent).toHaveLength(1);
  });

  it("answers a known email before its mail has gone", async () => {
    await signUpUser("timing@example.com");
    const held: (() => void)[] = [];
    // oxlint-disable-next-line promise/avoid-new -- the test says when the mail goes, which only a promise can hold
    const gate = new Promise<void>((resolve) => {
      held.push(resolve);
    });
    const { EMAIL, sent } = recordingEmail(gate);
    const ctx = createExecutionContext();

    const response = await answerToReset("timing@example.com", envWith(EMAIL), ctx);
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(0);

    for (const release of held) {
      release();
    }
    await waitOnExecutionContext(ctx);
    expect(sent).toHaveLength(1);
  });

  it("the emailed link's GET leg lands on the site's reset page with the token", async () => {
    await signUpUser("page@example.com");
    const { EMAIL, sent } = recordingEmail();
    await drained(requestReset("page@example.com", envWith(EMAIL)));

    const landing = await followGetLeg(extractResetLink(firstEmail(sent)));
    expect(landing.origin).toBe(ORIGIN);
    expect(landing.pathname).toBe(RESET_PAGE_PATH);
    expect(landing.searchParams.get("token")).toMatch(/^[A-Za-z0-9]+$/u);
    // no door answers it: the page is the site's own Start route
    expect(doorAt(landing.pathname)).toBeUndefined();
  });

  it("carries a way back through the mail to the reset page", async () => {
    await signUpUser("way-back@example.com");
    const { EMAIL, sent } = recordingEmail();
    const way = "/connect/authorize?client_id=c1&state=s1";
    const page = `${RESET_PAGE_PATH}?next=${encodeURIComponent(way)}`;
    await drained(requestReset("way-back@example.com", envWith(EMAIL), page));

    const landing = await followGetLeg(extractResetLink(firstEmail(sent)));
    expect(landing.origin).toBe(ORIGIN);
    expect(landing.pathname).toBe(RESET_PAGE_PATH);
    expect(landing.searchParams.get("next")).toBe(way);
    expect(landing.searchParams.get("token")).toMatch(/^[A-Za-z0-9]+$/u);
  });

  it("sends no mail that would land off this site", async () => {
    await signUpUser("off-site@example.com");
    const { EMAIL, sent } = recordingEmail();

    for (const stranger of [
      "https://evil.example/app/reset-password",
      "//evil.example/app/reset-password",
      "/\\evil.example/app/reset-password",
    ]) {
      const response = await requestReset("off-site@example.com", envWith(EMAIL), stranger);
      expect(response.status, stranger).toBe(403);
    }
    expect(sent).toHaveLength(0);
  });

  it("lands a link rewritten to leave this site nowhere", async () => {
    await signUpUser("rewritten@example.com");
    const { EMAIL, sent } = recordingEmail();
    await drained(requestReset("rewritten@example.com", envWith(EMAIL)));
    const link = new URL(extractResetLink(firstEmail(sent)));
    link.searchParams.set("callbackURL", "https://evil.example/app/reset-password");

    const response = await drained(exports.default.fetch(link, { redirect: "manual" }));
    expect(response.status).toBe(403);
    expect(response.headers.get("location")).toBeNull();
  });

  it("refuses a new password outside the contract's bounds, which Better Auth is configured with", async () => {
    await signUpUser("bounds@example.com");
    for (const newPassword of [
      "x".repeat(PASSWORD_MIN_LENGTH - 1),
      "x".repeat(PASSWORD_MAX_LENGTH + 1),
    ]) {
      const token = await issueToken("bounds@example.com");
      const reset = await drained(
        exports.default.fetch(`${ORIGIN}/api/auth/reset-password`, {
          body: JSON.stringify({ newPassword, token }),
          headers: { "content-type": "application/json", origin: ORIGIN },
          method: "POST",
        }),
      );
      expect(reset.status, String(newPassword.length)).toBe(400);
    }
  });

  it("a valid token changes the password: new sign-in works, old fails", async () => {
    const { password } = await signUpUser("happy-path@example.com");
    const token = await issueToken("happy-path@example.com");

    const reset = await exports.default.fetch(`${ORIGIN}/api/auth/reset-password`, {
      body: JSON.stringify({ newPassword: NEW_PASSWORD, token }),
      headers: { "content-type": "application/json", origin: ORIGIN },
      method: "POST",
    });
    expect(reset.status).toBe(200);
    await expect(reset.json()).resolves.toMatchObject({ status: true });

    const withOld = await drained(signIn("happy-path@example.com", password));
    expect(withOld.status).toBe(401);
    const withNew = await drained(signIn("happy-path@example.com", NEW_PASSWORD));
    expect(withNew.status).toBe(200);
  });

  it("a token is SINGLE-USE — the second consume is rejected", async () => {
    await signUpUser("single-use@example.com");
    const token = await issueToken("single-use@example.com");
    const body = JSON.stringify({ newPassword: NEW_PASSWORD, token });
    const post = async () =>
      await exports.default.fetch(`${ORIGIN}/api/auth/reset-password`, {
        body,
        headers: { "content-type": "application/json", origin: ORIGIN },
        method: "POST",
      });
    const consumed = await drained(post());
    expect(consumed.status).toBe(200);
    const replayed = await drained(post());
    expect(replayed.status).toBe(400);
  });

  it("invalid and EXPIRED tokens are rejected; the dead link's GET leg reports error", async () => {
    const invalid = await drained(
      exports.default.fetch(`${ORIGIN}/api/auth/reset-password`, {
        body: JSON.stringify({ newPassword: NEW_PASSWORD, token: "a".repeat(24) }),
        headers: { "content-type": "application/json", origin: ORIGIN },
        method: "POST",
      }),
    );
    expect(invalid.status).toBe(400);

    const { password } = await signUpUser("expired@example.com");
    const { EMAIL, sent } = recordingEmail();
    await drained(requestReset("expired@example.com", envWith(EMAIL)));
    const link = extractResetLink(firstEmail(sent));
    const token = new URL(link).pathname.split("/").at(-1);
    if (token === undefined) {
      throw new Error("no token in link");
    }
    await createDb(env.DB)
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verification.identifier, `reset-password:${token}`));

    const expired = await drained(
      exports.default.fetch(`${ORIGIN}/api/auth/reset-password`, {
        body: JSON.stringify({ newPassword: NEW_PASSWORD, token }),
        headers: { "content-type": "application/json", origin: ORIGIN },
        method: "POST",
      }),
    );
    expect(expired.status).toBe(400);
    const landing = await followGetLeg(link);
    expect(landing.pathname).toBe(RESET_PAGE_PATH);
    expect(landing.searchParams.get("error")).toBe("INVALID_TOKEN");
    expect(landing.searchParams.get("token")).toBeNull();

    const stillOld = await drained(signIn("expired@example.com", password));
    expect(stillOld.status).toBe(200);
  });

  it("an ABSENT EMAIL binding or sender degrades to a warning, and the sender is honored", async () => {
    await expect(
      sendResetEmail({}, "user@example.com", "https://x/reset"),
    ).resolves.toBeUndefined();
    const unsent = recordingEmail();
    await sendResetEmail({ EMAIL: unsent.EMAIL }, "user@example.com", "https://x/reset");
    expect(unsent.sent).toStrictEqual([]);

    const { EMAIL, sent } = recordingEmail();
    await sendResetEmail(
      { EMAIL, RESET_FROM_ADDRESS: "hello@custom-domain.app" },
      "user@example.com",
      "https://x/reset",
    );
    expect(firstEmail(sent).from).toStrictEqual({
      email: "hello@custom-domain.app",
      name: "inteligir",
    });
  });
});
