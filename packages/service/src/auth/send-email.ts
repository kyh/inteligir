import { randomUUID } from "node:crypto";

import type { ErrorResponse } from "resend";
import { Resend } from "resend";

import { env } from "../env";
import { errorFields } from "../log";

export type EmailMode =
  | { readonly kind: "resend"; readonly apiKey: string; readonly from: string }
  | { readonly kind: "log" }
  | { readonly kind: "off" };

export interface EmailMessage {
  /** for logs only, never the address */
  readonly label: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly to: string;
}

type EmailSettings = Pick<typeof env, "EMAIL_FROM" | "EMAIL_MODE" | "RESEND_API_KEY">;

export const emailModeOf = (
  { EMAIL_FROM, EMAIL_MODE, RESEND_API_KEY }: EmailSettings,
  production: boolean,
) => {
  const kind = EMAIL_MODE ?? (production ? "off" : "log");

  switch (kind) {
    case "resend": {
      return (
        RESEND_API_KEY === undefined || EMAIL_FROM === undefined
          ? { kind: "off" }
          : { apiKey: RESEND_API_KEY, from: EMAIL_FROM, kind: "resend" }
      ) satisfies EmailMode;
    }

    case "log": {
      return { kind: "log" } satisfies EmailMode;
    }

    case "off": {
      return { kind: "off" } satisfies EmailMode;
    }

    default: {
      const exhaustive: never = kind;

      return exhaustive;
    }
  }
};

export const EMAIL_MODE = emailModeOf(env, process.env.NODE_ENV === "production");

/** for the boot log: what the mode means for whoever runs the deployment, if anything */
export const emailModeWarning = (mode: EmailMode, production: boolean) => {
  if (mode.kind === "off") {
    return "This deployment sends no email, so nobody can sign in: a sign-in code is mailed. Set EMAIL_MODE=resend with RESEND_API_KEY and EMAIL_FROM.";
  }

  if (mode.kind === "log" && production) {
    return "EMAIL_MODE=log writes every mail to the server's log, live sign-in codes included.";
  }

  return null;
};

const mayHaveFailedInTransit = ({ statusCode }: ErrorResponse) =>
  statusCode === null || statusCode >= 500;

const sendThroughResend = async (
  message: EmailMessage,
  mode: Extract<EmailMode, { kind: "resend" }>,
) => {
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
      return "sent" as const;
    }

    console.error(
      `[send-email] ${message.label}: Resend didn't send it (${String(error.statusCode ?? "no answer")})`,
      error.message,
    );

    return "failed" as const;
  } catch (error) {
    console.error({ event: "send-email-failed", label: message.label, ...errorFields(error) });

    return "failed" as const;
  }
};

export const deliverEmail = async (message: EmailMessage, mode: EmailMode = EMAIL_MODE) => {
  switch (mode.kind) {
    case "resend": {
      return await sendThroughResend(message, mode);
    }

    case "log": {
      console.log(`[send-email] ${message.label}: not sent (EMAIL_MODE=log), logged here`);
      console.log(`[send-email] to: ${message.to}`);
      console.log(`[send-email] subject: ${message.subject}`);
      console.log(`[send-email] body: ${message.text}`);

      return "logged" as const;
    }

    case "off": {
      console.warn(`[send-email] ${message.label}: not sent (this deployment sends no email)`);

      return "off" as const;
    }

    default: {
      const exhaustive: never = mode;

      return exhaustive;
    }
  }
};
