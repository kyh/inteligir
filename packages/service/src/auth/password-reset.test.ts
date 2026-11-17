import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@repo/contract/account/account-schema";
import { verification } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { dbSuite } from "@repo/db/test-database";
import { eq } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";

import { authFetch, authPost, ORIGIN, signUpUser } from "../test-support/auth-requests";
import {
  followGetLeg,
  issueToken,
  mailedResetLink,
  requestReset,
  RESET_PAGE_PATH,
  watchMailLog,
} from "../test-support/password-reset";

// the new password every reset here sets
const NEW_PASSWORD = "new-password-5678";

const signIn = async (email: string, password: string): Promise<Response> =>
  await authPost("/sign-in/email", { origin: ORIGIN }, { email, password });

const resetPassword = async (newPassword: string, token: string): Promise<Response> =>
  await authPost("/reset-password", { origin: ORIGIN }, { newPassword, token });

afterEach(() => {
  vi.restoreAllMocks();
});

dbSuite("password reset", () => {
  it("mails a known address one reset link on this site, for the page it named", async () => {
    await signUpUser("known@example.com");
    const mail = watchMailLog();

    const response = await requestReset("known@example.com");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: true });

    const link = await mail.latestLink();
    expect(mail.links()).toHaveLength(1);
    expect(mail.lines()).toContain("[send-email] to: known@example.com");
    expect(mail.lines()).toContain("[send-email] subject: Reset your inteligir password");
    expect(link).toContain(`${ORIGIN}/api/auth/reset-password/`);
    expect(link).toContain(`callbackURL=${encodeURIComponent(RESET_PAGE_PATH)}`);
  });

  it("answers an unknown address byte for byte as a known one, and mails it nothing", async () => {
    await signUpUser("oracle-probe@example.com");
    const mail = watchMailLog();

    const unknown = await requestReset("nobody-ever-signed-up@example.com");
    const known = await requestReset("oracle-probe@example.com");
    await mail.latestLink();

    expect(unknown.status).toBe(known.status);
    await expect(unknown.text()).resolves.toBe(await known.text());
    expect(mail.links()).toHaveLength(1);
    expect(mail.lines().join("\n")).not.toContain("nobody-ever-signed-up@example.com");
  });

  it("lands the mailed link's GET leg on the site's reset page with the token", async () => {
    await signUpUser("page@example.com");
    const landing = await followGetLeg(await mailedResetLink("page@example.com"));
    expect(landing.origin).toBe(ORIGIN);
    expect(landing.pathname).toBe(RESET_PAGE_PATH);
    expect(landing.searchParams.get("token")).toMatch(/^[A-Za-z0-9]+$/u);
  });

  it("carries a way back through the mail to the reset page", async () => {
    await signUpUser("way-back@example.com");
    const way = "/connect/authorize?client_id=c1&state=s1";
    const page = `${RESET_PAGE_PATH}?next=${encodeURIComponent(way)}`;

    const landing = await followGetLeg(await mailedResetLink("way-back@example.com", page));
    expect(landing.origin).toBe(ORIGIN);
    expect(landing.pathname).toBe(RESET_PAGE_PATH);
    expect(landing.searchParams.get("next")).toBe(way);
    expect(landing.searchParams.get("token")).toMatch(/^[A-Za-z0-9]+$/u);
  });

  it("sends no mail that would land off this site", async () => {
    await signUpUser("off-site@example.com");
    const mail = watchMailLog();

    for (const stranger of [
      "https://evil.example/app/reset-password",
      "//evil.example/app/reset-password",
      "/\\evil.example/app/reset-password",
    ]) {
      const response = await requestReset("off-site@example.com", stranger);
      expect(response.status, stranger).toBe(403);
    }
    expect(mail.links()).toHaveLength(0);
  });

  it("lands a link rewritten to leave this site nowhere", async () => {
    await signUpUser("rewritten@example.com");
    const link = new URL(await mailedResetLink("rewritten@example.com"));
    link.searchParams.set("callbackURL", "https://evil.example/app/reset-password");

    const response = await authFetch(`${link.pathname.replace(/^\/api\/auth/u, "")}${link.search}`);
    expect(response.status).toBe(403);
    expect(response.headers.get("location")).toBeNull();
  });

  it("refuses a new password outside the contract's bounds, which Better Auth is configured with", async () => {
    await signUpUser("bounds@example.com");
    for (const newPassword of [
      "x".repeat(PASSWORD_MIN_LENGTH - 1),
      "x".repeat(PASSWORD_MAX_LENGTH + 1),
    ]) {
      const reset = await resetPassword(newPassword, await issueToken("bounds@example.com"));
      expect(reset.status, String(newPassword.length)).toBe(400);
    }
  });

  it("changes the password on a valid token: the new one signs in, the old one no longer", async () => {
    const { password } = await signUpUser("happy-path@example.com");
    const reset = await resetPassword(NEW_PASSWORD, await issueToken("happy-path@example.com"));
    expect(reset.status).toBe(200);
    await expect(reset.json()).resolves.toMatchObject({ status: true });

    const withOld = await signIn("happy-path@example.com", password);
    expect(withOld.status).toBe(401);
    const withNew = await signIn("happy-path@example.com", NEW_PASSWORD);
    expect(withNew.status).toBe(200);
  });

  it("takes a token once: the second use is refused", async () => {
    await signUpUser("single-use@example.com");
    const token = await issueToken("single-use@example.com");
    const consumed = await resetPassword(NEW_PASSWORD, token);
    expect(consumed.status).toBe(200);
    const replayed = await resetPassword(NEW_PASSWORD, token);
    expect(replayed.status).toBe(400);
  });

  it("refuses an invalid or an expired token, and the dead link's GET leg says so", async () => {
    const invalid = await resetPassword(NEW_PASSWORD, "a".repeat(24));
    expect(invalid.status).toBe(400);

    const { password } = await signUpUser("expired@example.com");
    const link = await mailedResetLink("expired@example.com");
    const token = new URL(link).pathname.split("/").at(-1);
    if (token === undefined) {
      throw new Error("no token in link");
    }
    await db
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verification.identifier, `reset-password:${token}`));

    const expired = await resetPassword(NEW_PASSWORD, token);
    expect(expired.status).toBe(400);
    const landing = await followGetLeg(link);
    expect(landing.pathname).toBe(RESET_PAGE_PATH);
    expect(landing.searchParams.get("error")).toBe("INVALID_TOKEN");
    expect(landing.searchParams.get("token")).toBeNull();

    const stillOld = await signIn("expired@example.com", password);
    expect(stillOld.status).toBe(200);
  });
});
