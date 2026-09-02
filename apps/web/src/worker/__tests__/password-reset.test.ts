import { eq } from "drizzle-orm";
import { createExecutionContext, env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../index";
import { sendResetEmail } from "../auth/reset-email";
import { createDb } from "../db/client";
import { verification } from "../db/schema";
import { ORIGIN, signUpUser } from "./cloud-helpers";

// email delivery cannot run here (it needs the owner's sending domain), so requests that
// must observe the send go through `worker.fetch` with a recording EMAIL binding
const NEW_PASSWORD = "new-password-5678";

type RecordedEmail = EmailMessageBuilder;

interface EmailRecorder {
  EMAIL: SendEmail;
  sent: RecordedEmail[];
}

function recordingEmail(): EmailRecorder {
  const sent: RecordedEmail[] = [];
  const EMAIL: SendEmail = {
    send: async (message: EmailMessage | EmailMessageBuilder): Promise<EmailSendResult> => {
      if (!("subject" in message)) throw new Error("unexpected raw EmailMessage send");
      sent.push(message);
      return { messageId: `mock-${String(sent.length)}` };
    },
  };
  return { EMAIL, sent };
}

function envWith(EMAIL: SendEmail): Env {
  return { ...env, EMAIL };
}

// worker.fetch rather than SELF.fetch: it is the only way to swap in the recording EMAIL binding
function requestReset(email: string, testEnv: Env): Promise<Response> {
  return worker.fetch(
    new Request(ORIGIN + "/api/auth/request-password-reset", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email, redirectTo: "/auth/reset" }),
    }),
    testEnv,
    createExecutionContext(),
  );
}

function signIn(email: string, password: string): Promise<Response> {
  return SELF.fetch(ORIGIN + "/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email, password }),
  });
}

function firstEmail(sent: RecordedEmail[]): RecordedEmail {
  const first = sent[0];
  if (first === undefined) throw new Error("no email recorded");
  return first;
}

function extractResetLink(message: RecordedEmail): string {
  const match = /https:\/\/\S*\/api\/auth\/reset-password\/\S+/.exec(message.text ?? "");
  if (match === null) throw new Error("no reset link in the email text");
  return match[0];
}

async function followGetLeg(link: string): Promise<URL> {
  const response = await SELF.fetch(link, { redirect: "manual" });
  expect(response.status).toBe(302);
  const location = response.headers.get("location");
  if (location === null) throw new Error("GET leg did not redirect");
  return new URL(location);
}

async function issueToken(email: string): Promise<string> {
  const { EMAIL, sent } = recordingEmail();
  const response = await requestReset(email, envWith(EMAIL));
  expect(response.status).toBe(200);
  const landing = await followGetLeg(extractResetLink(firstEmail(sent)));
  const token = landing.searchParams.get("token");
  if (token === null) throw new Error("GET leg redirected without a token");
  return token;
}

describe("password reset", () => {
  it("a known email gets ONE reset email carrying the URL, from the configured sender", async () => {
    await signUpUser("known@example.com");
    const { EMAIL, sent } = recordingEmail();

    const response = await requestReset("known@example.com", envWith(EMAIL));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: true });

    expect(sent).toHaveLength(1);
    const message = sent[0];
    if (message === undefined) throw new Error("unreachable");
    expect(message.to).toBe("known@example.com");
    expect(message.from).toEqual({ name: "inteligir", email: "no-reply@inteligir.app" });
    expect(message.subject).toBe("Reset your inteligir password");
    const link = extractResetLink(message);
    expect(link).toContain(ORIGIN + "/api/auth/reset-password/");
    expect(link).toContain("callbackURL=%2Fauth%2Freset");
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
    expect(await unknown.text()).toBe(knownBody);
    expect(sent).toHaveLength(1);
  });

  it("the emailed link's GET leg lands on /auth/reset with the token; the page serves no-store", async () => {
    await signUpUser("page@example.com");
    const { EMAIL, sent } = recordingEmail();
    await requestReset("page@example.com", envWith(EMAIL));

    const landing = await followGetLeg(extractResetLink(firstEmail(sent)));
    expect(landing.pathname).toBe("/auth/reset");
    expect(landing.searchParams.get("token")).toMatch(/^[A-Za-z0-9]+$/);

    const page = await SELF.fetch(landing.toString());
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
    const html = await page.text();
    expect(html).toContain('id="reset-form"');
    expect(html).toContain("/api/auth/reset-password");
  });

  it("a valid token changes the password: new sign-in works, old fails", async () => {
    const { password } = await signUpUser("happy-path@example.com");
    const token = await issueToken("happy-path@example.com");

    const reset = await SELF.fetch(ORIGIN + "/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ newPassword: NEW_PASSWORD, token }),
    });
    expect(reset.status).toBe(200);
    expect(await reset.json()).toMatchObject({ status: true });

    expect((await signIn("happy-path@example.com", password)).status).toBe(401);
    expect((await signIn("happy-path@example.com", NEW_PASSWORD)).status).toBe(200);
  });

  it("a token is SINGLE-USE — the second consume is rejected", async () => {
    await signUpUser("single-use@example.com");
    const token = await issueToken("single-use@example.com");
    const body = JSON.stringify({ newPassword: NEW_PASSWORD, token });
    const post = () =>
      SELF.fetch(ORIGIN + "/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body,
      });
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(400);
  });

  it("invalid and EXPIRED tokens are rejected; the dead link's GET leg reports error", async () => {
    const invalid = await SELF.fetch(ORIGIN + "/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ newPassword: NEW_PASSWORD, token: "a".repeat(24) }),
    });
    expect(invalid.status).toBe(400);

    const { password } = await signUpUser("expired@example.com");
    const { EMAIL, sent } = recordingEmail();
    await requestReset("expired@example.com", envWith(EMAIL));
    const link = extractResetLink(firstEmail(sent));
    const token = new URL(link).pathname.split("/").at(-1);
    if (token === undefined) throw new Error("no token in link");
    await createDb(env.DB)
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(verification.identifier, `reset-password:${token}`));

    const expired = await SELF.fetch(ORIGIN + "/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ newPassword: NEW_PASSWORD, token }),
    });
    expect(expired.status).toBe(400);
    const landing = await followGetLeg(link);
    expect(landing.pathname).toBe("/auth/reset");
    expect(landing.searchParams.get("error")).toBe("INVALID_TOKEN");
    expect(landing.searchParams.get("token")).toBeNull();

    expect((await signIn("expired@example.com", password)).status).toBe(200);
  });

  it("an ABSENT EMAIL binding degrades to a warning, and the from-address knob is honored", async () => {
    await expect(
      sendResetEmail({}, "user@example.com", "https://x/reset"),
    ).resolves.toBeUndefined();

    const { EMAIL, sent } = recordingEmail();
    await sendResetEmail(
      { EMAIL, RESET_FROM_ADDRESS: "hello@custom-domain.app" },
      "user@example.com",
      "https://x/reset",
    );
    expect(firstEmail(sent).from).toEqual({ name: "inteligir", email: "hello@custom-domain.app" });
  });
});
