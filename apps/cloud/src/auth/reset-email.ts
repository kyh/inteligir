// ---------------------------------------------------------------------------
// Password-reset email over Cloudflare Email Sending. Better
// Auth's `emailAndPassword.sendResetPassword` lands here with the reset URL it
// minted (`/api/auth/reset-password/<token>?callbackURL=/auth/reset` — the GET
// leg validates the token, then redirects to the reset PAGE with `?token=`).
//
// The `send_email` binding needs no API key: delivery works as soon as the
// owner onboards the sending domain (`wrangler email sending enable
// inteligir.app` + dashboard DKIM/SPF DNS). Two failure modes are absorbed
// here rather than thrown, because the reset-request response must stay
// NEUTRAL (a caller must never learn from an error whether the email exists):
//   • binding absent (a dev config without `send_email`) — warn and return;
//     the token was already issued, so the flow stays testable end to end.
//   • send rejected (domain not yet onboarded → E_SENDER_NOT_VERIFIED, rate
//     limits, …) — log and return. Better Auth would swallow a throw anyway
//     (`runInBackgroundOrAwait` catches), but absorbing it here keeps the
//     contract explicit instead of leaning on that internal.
// ---------------------------------------------------------------------------

/** Default sender — overridable via the RESET_FROM_ADDRESS env var so the
 * owner can match whatever domain they actually verified. */
const DEFAULT_FROM_ADDRESS = "no-reply@inteligir.app";

/** Display name on the from-address. */
const FROM_NAME = "inteligir";

/** Compose the reset email. Plain-text plus a minimal HTML alternative —
 * both carry the URL, per deliverability guidance (text-only clients + spam
 * scoring). Tests assert on the recorded builder the mock binding captures. */
function composeResetEmail(url: string): { subject: string; text: string; html: string } {
  return {
    subject: "Reset your inteligir password",
    text: [
      "Someone asked to reset the password for your inteligir account.",
      "",
      `Reset it here (the link expires in one hour): ${url}`,
      "",
      "If this wasn't you, ignore this email — your password is unchanged.",
    ].join("\n"),
    // The URL is better-auth-minted (base64url token on our own origin), so
    // embedding it in HTML needs no escaping.
    html: [
      "<p>Someone asked to reset the password for your inteligir account.</p>",
      `<p><a href="${url}">Reset your password</a> (the link expires in one hour).</p>`,
      "<p>If this wasn't you, ignore this email — your password is unchanged.</p>",
    ].join("\n"),
  };
}

/** The two env members the send actually uses — narrower than the generated
 * `Env` (which types the binding always-present) so the absent-binding
 * degradation is representable and unit-testable without a full Worker env. */
export type ResetEmailEnv = {
  readonly EMAIL?: SendEmail;
  readonly RESET_FROM_ADDRESS?: string;
};

/** Send the reset email for `sendResetPassword`. Never throws — see header. */
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
    // Most likely the owner hasn't onboarded the sending domain yet
    // (E_SENDER_NOT_VERIFIED). Log it; the response stays neutral.
    console.error("password reset: email send failed", error);
  }
}
