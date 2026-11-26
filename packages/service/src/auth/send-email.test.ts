import { afterEach, describe, expect, it, vi } from "vitest";

import { deliverEmail, emailModeOf, emailModeWarning } from "./send-email";
import { composeSignInCodeEmail } from "./sign-in-code-email";

const UNSET = { EMAIL_FROM: undefined, EMAIL_MODE: undefined, RESEND_API_KEY: undefined };
const SENDER = "inteligir <hello@custom-domain.example>";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the mail mode", () => {
  it("logs outside production and sends nothing in it, when nothing names one", () => {
    expect(emailModeOf(UNSET, false)).toStrictEqual({ kind: "log" });
    expect(emailModeOf(UNSET, true)).toStrictEqual({ kind: "off" });
  });

  it("sends through Resend from the sender the deployment names", () => {
    expect(
      emailModeOf({ EMAIL_FROM: SENDER, EMAIL_MODE: "resend", RESEND_API_KEY: "re_test" }, true),
    ).toStrictEqual({ apiKey: "re_test", from: SENDER, kind: "resend" });
  });

  it("warns whoever runs a deployment that cannot mail, or that logs live links", () => {
    expect(emailModeWarning({ kind: "off" }, true)).toMatch(/EMAIL_FROM/u);
    expect(emailModeWarning({ kind: "log" }, true)).toMatch(/sign-in codes/u);
    expect(emailModeWarning({ kind: "log" }, false)).toBeNull();
  });
});

describe("a sign-in code's mail", () => {
  it("carries its code in the subject, the text and the markup, to the address asked for", () => {
    const message = composeSignInCodeEmail("user@example.com", "123456");
    expect(message.to).toBe("user@example.com");
    expect(message.subject).toBe("123456 is your inteligir sign-in code");
    expect(message.text).toContain("123456");
    expect(message.html).toContain("123456");
  });

  it("goes nowhere and logs no address with mail off", async () => {
    const warn = vi.spyOn(console, "warn");

    await expect(
      deliverEmail(composeSignInCodeEmail("user@example.com", "123456"), { kind: "off" }),
    ).resolves.toBe("off");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("user@example.com");
  });
});
