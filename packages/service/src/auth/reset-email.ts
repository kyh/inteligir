import type { EmailMessage } from "./send-email";
import { deliverEmail } from "./send-email";

export const composeResetEmail = (to: string, url: string) =>
  ({
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
  }) satisfies EmailMessage;

export const sendResetEmail = async (to: string, url: string) => {
  await deliverEmail(composeResetEmail(to, url));
};
