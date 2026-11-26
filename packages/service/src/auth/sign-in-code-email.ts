import type { EmailMessage } from "./send-email";
import { deliverEmail } from "./send-email";

export const composeSignInCodeEmail = (to: string, code: string) =>
  ({
    html: [
      "<p>Enter this code to sign in to inteligir:</p>",
      `<p style="font-size:24px;font-weight:600;letter-spacing:4px">${code}</p>`,
      "<p>It expires in five minutes. If this wasn't you, ignore this email: nobody can sign in without the code.</p>",
    ].join("\n"),
    label: "sign-in code",
    subject: `${code} is your inteligir sign-in code`,
    text: [
      `Enter this code to sign in to inteligir: ${code}`,
      "",
      "It expires in five minutes. If this wasn't you, ignore this email: nobody can sign in without the code.",
    ].join("\n"),
    to,
  }) satisfies EmailMessage;

export const sendSignInCode = async (to: string, code: string) => {
  await deliverEmail(composeSignInCodeEmail(to, code));
};
