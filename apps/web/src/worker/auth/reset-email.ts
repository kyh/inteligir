import { errorFields } from "../log";

// Never throws: the reset-request response must stay neutral, so an absent transport (a preview or
// a dev config, with no send_email binding or sender) warns and returns, and a rejected send
// (domain not onboarded, E_SENDER_NOT_VERIFIED) logs and returns.

const FROM_NAME = "inteligir";

// text and html both carry the URL: text-only clients, and spam scoring
interface ResetEmail {
  subject: string;
  text: string;
  html: string;
}

const composeResetEmail = (url: string): ResetEmail => ({
  // the URL is better-auth-minted on this origin (base64url token), so it needs no escaping
  html: [
    "<p>Someone asked to reset the password for your inteligir account.</p>",
    `<p><a href="${url}">Reset your password</a> (the link expires in one hour).</p>`,
    "<p>If this wasn't you, ignore this email — your password is unchanged.</p>",
  ].join("\n"),
  subject: "Reset your inteligir password",
  text: [
    "Someone asked to reset the password for your inteligir account.",
    "",
    `Reset it here (the link expires in one hour): ${url}`,
    "",
    "If this wasn't you, ignore this email — your password is unchanged.",
  ].join("\n"),
});

// what the send reads of Env: the two bindings only production declares (cloudflare.config.ts)
export interface ResetEmailEnv {
  readonly EMAIL?: SendEmail;
  readonly RESET_FROM_ADDRESS?: string;
}

export const sendResetEmail = async (
  env: ResetEmailEnv,
  to: string,
  url: string,
): Promise<void> => {
  if (env.EMAIL === undefined || env.RESET_FROM_ADDRESS === undefined) {
    console.warn({ event: "reset-email-skipped", reason: "no EMAIL binding or sender" });
    return;
  }
  const { subject, text, html } = composeResetEmail(url);
  try {
    await env.EMAIL.send({
      from: { email: env.RESET_FROM_ADDRESS, name: FROM_NAME },
      html,
      subject,
      text,
      to,
    });
  } catch (error) {
    console.error({ event: "reset-email-failed", ...errorFields(error) });
  }
};
