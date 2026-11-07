// A password reset as the site asks for one, its email caught by a recording binding: delivery
// cannot run here (it needs the owner's sending domain), so a request that must observe the send
// goes through `worker.fetch` with the recording EMAIL binding.

import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { expect } from "vitest";

import worker from "../index";
import { drained, ORIGIN } from "./cloud-helpers";

// the site's /app/reset-password route, which the forgot-password page names as its redirectTo;
// the route tree is the site program's, which this one cannot import
export const RESET_PAGE_PATH = "/app/reset-password";

export type RecordedEmail = EmailMessageBuilder;

interface EmailRecorder {
  EMAIL: SendEmail;
  sent: RecordedEmail[];
}

// each mail is recorded once `gate` settles, so a test can hold it mid-send
export const recordingEmail = (gate: Promise<void> = Promise.resolve()): EmailRecorder => {
  const sent: RecordedEmail[] = [];
  const EMAIL: SendEmail = {
    send: async (message: EmailMessage | EmailMessageBuilder): Promise<EmailSendResult> => {
      await gate;
      if (!("subject" in message)) {
        throw new Error("unexpected raw EmailMessage send");
      }
      sent.push(message);
      return { messageId: `mock-${String(sent.length)}` };
    },
  };
  return { EMAIL, sent };
};

// production's two reset bindings, which the suites' own config leaves out; the sender is typed by
// what cloudflare.config.ts declares
export const SENDER: Env["RESET_FROM_ADDRESS"] = "no-reply@inteligir.app";
export const envWith = (EMAIL: SendEmail): Env => ({ ...env, EMAIL, RESET_FROM_ADDRESS: SENDER });

// worker.fetch rather than exports.default.fetch: it is the only way to swap in the recording EMAIL
// binding
export const answerToReset = async (
  email: string,
  testEnv: Env,
  ctx: ExecutionContext,
  redirectTo: string = RESET_PAGE_PATH,
): Promise<Response> =>
  await worker.fetch(
    new Request(`${ORIGIN}/api/auth/request-password-reset`, {
      body: JSON.stringify({ email, redirectTo }),
      headers: { "content-type": "application/json", origin: ORIGIN },
      method: "POST",
    }),
    testEnv,
    ctx,
  );

// the answer, once whatever it left to the runtime has run
export const requestReset = async (
  email: string,
  testEnv: Env,
  redirectTo?: string,
): Promise<Response> => {
  const ctx = createExecutionContext();
  const response = await answerToReset(email, testEnv, ctx, redirectTo);
  await waitOnExecutionContext(ctx);
  return response;
};

export const firstEmail = (sent: RecordedEmail[]): RecordedEmail => {
  const [first] = sent;
  if (first === undefined) {
    throw new Error("no email recorded");
  }
  return first;
};

export const extractResetLink = (message: RecordedEmail): string => {
  const match = /https:\/\/\S*\/api\/auth\/reset-password\/\S+/u.exec(message.text ?? "");
  if (match === null) {
    throw new Error("no reset link in the email text");
  }
  return match[0];
};

export const followGetLeg = async (link: string): Promise<URL> => {
  const response = await drained(exports.default.fetch(link, { redirect: "manual" }));
  expect(response.status).toBe(302);
  const location = response.headers.get("location");
  if (location === null) {
    throw new Error("GET leg did not redirect");
  }
  return new URL(location);
};

export const issueToken = async (email: string): Promise<string> => {
  const { EMAIL, sent } = recordingEmail();
  const response = await drained(requestReset(email, envWith(EMAIL)));
  expect(response.status).toBe(200);
  const landing = await followGetLeg(extractResetLink(firstEmail(sent)));
  const token = landing.searchParams.get("token");
  if (token === null) {
    throw new Error("GET leg redirected without a token");
  }
  return token;
};
