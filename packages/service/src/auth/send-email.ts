// The one way mail goes out, dataembed's, in the mode the deployment's keys set once at load.
// `deliverEmail` never throws: it answers what became of the message. Outside log mode no log line
// holds an address or a body, since a reset mail carries a live token.
import { randomUUID } from "node:crypto";

import type { ErrorResponse } from "resend";
import { Resend } from "resend";

import { env } from "../env";

export type EmailMode =
  | { readonly kind: "resend"; readonly apiKey: string; readonly from: string }
  | { readonly kind: "log" }
  | { readonly kind: "off" };

type EmailDelivery = "sent" | "logged" | "off" | "failed";

export interface EmailMessage {
  /** for logs only, never the address */
  readonly label: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly to: string;
}

type EmailSettings = Pick<typeof env, "EMAIL_FROM" | "EMAIL_MODE" | "RESEND_API_KEY">;

// env.ts refuses `resend` without its key or its sender, so the fallback below is never reached
export const emailModeOf = (
  { EMAIL_FROM, EMAIL_MODE, RESEND_API_KEY }: EmailSettings,
  production: boolean,
): EmailMode => {
  const kind = EMAIL_MODE ?? (production ? "off" : "log");
  switch (kind) {
    case "resend": {
      return RESEND_API_KEY === undefined || EMAIL_FROM === undefined
        ? { kind: "off" }
        : { apiKey: RESEND_API_KEY, from: EMAIL_FROM, kind: "resend" };
    }
    case "log": {
      return { kind: "log" };
    }
    case "off": {
      return { kind: "off" };
    }
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
};

export const EMAIL_MODE = emailModeOf(env, process.env.NODE_ENV === "production");

/** for the boot log: what the mode means for whoever runs the deployment, if anything */
export const emailModeWarning = (mode: EmailMode, production: boolean): string | null => {
  if (mode.kind === "off") {
    return "This deployment sends no email: a forgotten password cannot be reset. Set EMAIL_MODE=resend with RESEND_API_KEY and EMAIL_FROM.";
  }
  if (mode.kind === "log" && production) {
    return "EMAIL_MODE=log writes every mail to the server's log, live reset links included.";
  }
  return null;
};

/** no answer, or a server error: the send may yet go through, or may have gone out already */
const mayHaveFailedInTransit = ({ statusCode }: ErrorResponse) =>
  statusCode === null || statusCode >= 500;

// A send whose fate is unknown is tried once more under the same key, which Resend answers with the
// first try's outcome, so a mail that went out is not sent twice.
const sendThroughResend = async (
  message: EmailMessage,
  mode: Extract<EmailMode, { kind: "resend" }>,
): Promise<EmailDelivery> => {
  const email = {
    from: mode.from,
    html: message.html,
    subject: message.subject,
    text: message.text,
    to: message.to,
  };
  const options = { idempotencyKey: randomUUID() };
  try {
    const resend = new Resend(mode.apiKey);
    const send = async () => await resend.emails.send(email, options);
    const first = await send();
    const { error } =
      first.error !== null && mayHaveFailedInTransit(first.error) ? await send() : first;
    if (error === null) {
      return "sent";
    }
    console.error(
      `[send-email] ${message.label}: Resend didn't send it (${String(error.statusCode ?? "no answer")})`,
      error.message,
    );
    return "failed";
  } catch (error) {
    console.error(`[send-email] ${message.label}: the Resend client failed`, error);
    return "failed";
  }
};

export const deliverEmail = async (
  message: EmailMessage,
  mode: EmailMode = EMAIL_MODE,
): Promise<EmailDelivery> => {
  switch (mode.kind) {
    case "resend": {
      return await sendThroughResend(message, mode);
    }
    case "log": {
      console.log(`[send-email] ${message.label}: not sent (EMAIL_MODE=log), logged here`);
      console.log(`[send-email] to: ${message.to}`);
      console.log(`[send-email] subject: ${message.subject}`);
      console.log(`[send-email] body: ${message.text}`);
      return "logged";
    }
    case "off": {
      console.warn(`[send-email] ${message.label}: not sent (this deployment sends no email)`);
      return "off";
    }
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
};
