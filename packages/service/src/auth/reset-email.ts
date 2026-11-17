import type { EmailMessage } from "./send-email";
import { deliverEmail } from "./send-email";

// text and html both carry the link: text-only clients, and spam scoring. The URL is minted by
// Better Auth on this app's origin with a base64url token, so it needs no escaping.
export const composeResetEmail = (to: string, url: string): EmailMessage => ({
  html: [
    "<p>Someone asked to reset the password for your inteligir account.</p>",
    `<p><a href="${url}">Reset your password</a> (the link expires in one hour).</p>`,
    "<p>If this wasn't you, ignore this email — your password is unchanged.</p>",
  ].join("\n"),
  label: "password reset",
  subject: "Reset your inteligir password",
  text: [
    "Someone asked to reset the password for your inteligir account.",
    "",
    `Reset it here (the link expires in one hour): ${url}`,
    "",
    "If this wasn't you, ignore this email — your password is unchanged.",
  ].join("\n"),
  to,
});

// Better Auth runs it in the background (`advanced.backgroundTasks`), so a failure reaches only the
// log `deliverEmail` writes, and the reset's answer never waits on it.
export const sendResetEmail = async (to: string, url: string): Promise<void> => {
  await deliverEmail(composeResetEmail(to, url));
};
