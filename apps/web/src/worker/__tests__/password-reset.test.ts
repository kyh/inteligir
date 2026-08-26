import { eq } from "drizzle-orm";
import { createExecutionContext, env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../index";
import { sendResetEmail } from "../auth/reset-email";
import { createDb } from "../db/client";
import { inviteCode, verification } from "../db/schema";

// The password-reset flow, driven against the real in-process Worker +
// D1. Email delivery is the ONE piece that can't run here (it needs the
// owner's onboarded sending domain), so requests that must observe the send go
// through `worker.fetch` with the pool env's bindings plus a MOCK `EMAIL`
// whose `.send` records the message-builder — everything else (token mint,
// consume, page serve, sign-in checks) is the production code path via SELF.
const ORIGIN = "https://inteligir-web.workers.dev";
const OLD_PASSWORD = "old-password-1234";
const NEW_PASSWORD = "new-password-5678";

/** What the Worker hands `EMAIL.send` — the message-builder object (the mock
 * never sees a raw `EmailMessage`; the send path doesn't construct MIME). */
type RecordedEmail = EmailMessageBuilder;

/** The mock binding and the messages it captured. */
interface EmailRecorder {
  EMAIL: SendEmail;
  sent: RecordedEmail[];
}

/** A recording stand-in for the `send_email` binding. */
function recordingEmail(): EmailRecorder {
  const sent: RecordedEmail[] = [];
  const EMAIL: SendEmail = {
    send: async (message: EmailMessage | EmailMessageBuilder): Promise<EmailSendResult> => {
      // Discriminate the overloads structurally: only the builder carries a
      // subject. A raw EmailMessage here would mean the send path changed —
      // fail loudly so the test is updated deliberately.
      if (!("subject" in message)) throw new Error("unexpected raw EmailMessage send");
      sent.push(message);
      return { messageId: `mock-${String(sent.length)}` };
    },
  };
  return { EMAIL, sent };
}

/** The pool env with the mock EMAIL swapped in — same D1 as SELF. */
function envWith(EMAIL: SendEmail): Env {
  return { ...env, EMAIL };
}

/** Mint an invite and hand back its code. A UUID rather than a counter: these
 * suites share one D1 per file and `code` is the primary key. */
async function mintInvite(): Promise<string> {
  const code = crypto.randomUUID();
  await createDb(env.DB).insert(inviteCode).values({ code });
  return code;
}

/** An account, through the invite gate — the only route that creates one. */
async function signUp(email: string): Promise<void> {
  const response = await SELF.fetch(ORIGIN + "/v1/auth/sign-up", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({
      email,
      password: OLD_PASSWORD,
      name: "user",
      inviteCode: await mintInvite(),
    }),
  });
  if (response.status !== 200) {
    throw new Error(`sign-up failed: ${String(response.status)} ${await response.text()}`);
  }
}

/** POST /api/auth/request-password-reset through the mock-EMAIL env. Called
 * directly rather than through `SELF.fetch` because that is the only way to
 * swap the `EMAIL` binding for one that records. */
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

/** The one recorded email, or a loud failure. */
function firstEmail(sent: RecordedEmail[]): RecordedEmail {
  const first = sent[0];
  if (first === undefined) throw new Error("no email recorded");
  return first;
}

/** Pull the emailed reset link (Better Auth's GET leg) out of the recorded
 * message's plain-text body. */
function extractResetLink(message: RecordedEmail): string {
  const match = /https:\/\/\S*\/api\/auth\/reset-password\/\S+/.exec(message.text ?? "");
  if (match === null) throw new Error("no reset link in the email text");
  return match[0];
}

/** Follow the GET leg without the redirect (so the Location target — the
 * reset PAGE URL with ?token= or ?error= — is observable). */
async function followGetLeg(link: string): Promise<URL> {
  const response = await SELF.fetch(link, { redirect: "manual" });
  expect(response.status).toBe(302);
  const location = response.headers.get("location");
  if (location === null) throw new Error("GET leg did not redirect");
  return new URL(location);
}

/** Request a reset for `email` and return the live token, via the full
 * email → GET leg → redirect pipeline (never minted directly). */
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
    await signUp("known@example.com");
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
    // Both bodies carry Better Auth's GET-leg URL, whose callbackURL is the
    // Worker-hosted reset page.
    const link = extractResetLink(message);
    expect(link).toContain(ORIGIN + "/api/auth/reset-password/");
    expect(link).toContain("callbackURL=%2Fauth%2Freset");
    expect(message.html).toContain(link);
  });

  it("an UNKNOWN email gets the byte-identical neutral response and NO email", async () => {
    await signUp("oracle-probe@example.com");
    const { EMAIL, sent } = recordingEmail();
    const testEnv = envWith(EMAIL);

    const known = await requestReset("oracle-probe@example.com", testEnv);
    const knownBody = await known.text();
    expect(sent).toHaveLength(1);

    const unknown = await requestReset("nobody-ever-signed-up@example.com", testEnv);
    // The no-oracle assertion: same status, same body, byte for byte — a
    // caller learns NOTHING about whether the email has an account…
    expect(unknown.status).toBe(known.status);
    expect(await unknown.text()).toBe(knownBody);
    // …and no email goes out that could differ in timing-observable cost.
    expect(sent).toHaveLength(1);
  });

  it("the emailed link's GET leg lands on /auth/reset with the token; the page serves no-store", async () => {
    await signUp("page@example.com");
    const { EMAIL, sent } = recordingEmail();
    await requestReset("page@example.com", envWith(EMAIL));

    const landing = await followGetLeg(extractResetLink(firstEmail(sent)));
    expect(landing.pathname).toBe("/auth/reset");
    expect(landing.searchParams.get("token")).toMatch(/^[A-Za-z0-9]+$/);

    const page = await SELF.fetch(landing.toString());
    expect(page.status).toBe(200);
    // The URL carries a live token — the page must never be cacheable.
    expect(page.headers.get("cache-control")).toBe("no-store");
    const html = await page.text();
    // The form the inline script drives, posting to Better Auth's endpoint.
    expect(html).toContain('id="reset-form"');
    expect(html).toContain("/api/auth/reset-password");
  });

  it("a valid token changes the password: new sign-in works, old fails", async () => {
    await signUp("happy-path@example.com");
    const token = await issueToken("happy-path@example.com");

    const reset = await SELF.fetch(ORIGIN + "/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ newPassword: NEW_PASSWORD, token }),
    });
    expect(reset.status).toBe(200);
    expect(await reset.json()).toMatchObject({ status: true });

    expect((await signIn("happy-path@example.com", OLD_PASSWORD)).status).toBe(401);
    expect((await signIn("happy-path@example.com", NEW_PASSWORD)).status).toBe(200);
  });

  it("a token is SINGLE-USE — the second consume is rejected", async () => {
    await signUp("single-use@example.com");
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
    // Invalid: never issued.
    const invalid = await SELF.fetch(ORIGIN + "/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ newPassword: NEW_PASSWORD, token: "a".repeat(24) }),
    });
    expect(invalid.status).toBe(400);

    // Expired: issue a real token, then age its verification row past TTL.
    await signUp("expired@example.com");
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
    // The GET leg on the dead link redirects to the page's invalid view.
    const landing = await followGetLeg(link);
    expect(landing.pathname).toBe("/auth/reset");
    expect(landing.searchParams.get("error")).toBe("INVALID_TOKEN");
    expect(landing.searchParams.get("token")).toBeNull();

    // The password is unchanged by either rejection.
    expect((await signIn("expired@example.com", OLD_PASSWORD)).status).toBe(200);
  });

  it("an ABSENT EMAIL binding degrades to a warning, and the from-address knob is honored", async () => {
    // Absent binding (a stripped-down dev config): no throw, no send — the
    // route above would still have issued the token and answered neutrally.
    await expect(
      sendResetEmail({}, "user@example.com", "https://x/reset"),
    ).resolves.toBeUndefined();

    // RESET_FROM_ADDRESS overrides the default sender.
    const { EMAIL, sent } = recordingEmail();
    await sendResetEmail(
      { EMAIL, RESET_FROM_ADDRESS: "hello@custom-domain.app" },
      "user@example.com",
      "https://x/reset",
    );
    expect(firstEmail(sent).from).toEqual({ name: "inteligir", email: "hello@custom-domain.app" });
  });
});
