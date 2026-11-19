import { afterEach, describe, expect, it, vi } from "vitest";

import { composeResetEmail } from "./reset-email";
import { deliverEmail, emailModeOf, emailModeWarning } from "./send-email";

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
    expect(emailModeWarning({ kind: "log" }, true)).toMatch(/reset links/u);
    expect(emailModeWarning({ kind: "log" }, false)).toBeNull();
  });
});

describe("a reset mail", () => {
  it("carries its link in the text and the markup, to the address asked for", () => {
    const url = "http://localhost:5174/api/auth/reset-password/abc?callbackURL=%2Fapp";
    const message = composeResetEmail("user@example.com", url);
    expect(message.to).toBe("user@example.com");
    expect(message.subject).toBe("Reset your inteligir password");
    expect(message.text).toContain(url);
    expect(message.html).toContain(url);
  });

  it("goes nowhere and logs no address with mail off", async () => {
    const warn = vi.spyOn(console, "warn");

    await expect(
      deliverEmail(composeResetEmail("user@example.com", "http://x/reset"), { kind: "off" }),
    ).resolves.toBe("off");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("user@example.com");
  });
});
