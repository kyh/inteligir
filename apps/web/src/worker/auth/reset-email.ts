// Never throws: the reset-request response must stay neutral, so an absent binding (a dev
// config without send_email) warns and returns, and a rejected send (domain not onboarded,
// E_SENDER_NOT_VERIFIED) logs and returns.

const DEFAULT_FROM_ADDRESS = "no-reply@inteligir.app";

const FROM_NAME = "inteligir";

// text and html both carry the URL: text-only clients, and spam scoring
interface ResetEmail {
  subject: string;
  text: string;
  html: string;
}

function composeResetEmail(url: string): ResetEmail {
  return {
    subject: "Reset your inteligir password",
    text: [
      "Someone asked to reset the password for your inteligir account.",
      "",
      `Reset it here (the link expires in one hour): ${url}`,
      "",
      "If this wasn't you, ignore this email — your password is unchanged.",
    ].join("\n"),
    // the URL is better-auth-minted on this origin (base64url token), so it needs no escaping
    html: [
      "<p>Someone asked to reset the password for your inteligir account.</p>",
      `<p><a href="${url}">Reset your password</a> (the link expires in one hour).</p>`,
      "<p>If this wasn't you, ignore this email — your password is unchanged.</p>",
    ].join("\n"),
  };
}

// narrower than Env, which types the binding always-present, so the absent-binding path is representable
export type ResetEmailEnv = {
  readonly EMAIL?: SendEmail;
  readonly RESET_FROM_ADDRESS?: string;
};

export async function sendResetEmail(env: ResetEmailEnv, to: string, url: string): Promise<void> {
  if (env.EMAIL === undefined) {
    console.warn("password reset: no EMAIL binding — reset email not sent");
    return;
  }
  const { subject, text, html } = composeResetEmail(url);
  try {
    await env.EMAIL.send({
      from: { name: FROM_NAME, email: env.RESET_FROM_ADDRESS ?? DEFAULT_FROM_ADDRESS },
      to,
      subject,
      text,
      html,
    });
  } catch (error) {
    console.error("password reset: email send failed", error);
  }
}
