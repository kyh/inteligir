import { describe, expect, it } from "vitest";
import {
  deleteAccountRequestSchema,
  SIGN_IN_CODE_LENGTH,
  signUpCodeRequestSchema,
  signUpRequestSchema,
} from "./account-schema";

describe("account deletion request", () => {
  it("asks for a code mailed to the account, and nothing else", () => {
    expect(deleteAccountRequestSchema.parse({ code: " 123456 " })).toStrictEqual({
      code: "123456",
    });
    expect(deleteAccountRequestSchema.validate({ code: "12345" })).toBe(false);
    expect(deleteAccountRequestSchema.validate({ code: "12345a" })).toBe(false);
    expect(deleteAccountRequestSchema.validate({ code: "123456", password: "x" })).toBe(false);
  });
});

describe("invite sign-up request", () => {
  const SIGN_UP = {
    code: "123456",
    email: "owner@example.test",
    inviteCode: "INVITE-1",
    name: "Owner",
  };

  it("trims every field", () => {
    expect(
      signUpRequestSchema.parse({
        code: " 123456 ",
        email: " owner@example.test ",
        inviteCode: " INVITE-1 ",
        name: " Owner ",
      }),
    ).toStrictEqual(SIGN_UP);
  });

  it(`takes a code of ${String(SIGN_IN_CODE_LENGTH)} digits`, () => {
    for (const [code, accepted] of [
      ["1".repeat(SIGN_IN_CODE_LENGTH - 1), false],
      ["1".repeat(SIGN_IN_CODE_LENGTH), true],
      ["1".repeat(SIGN_IN_CODE_LENGTH + 1), false],
      ["12 456", false],
    ] as const) {
      expect(signUpRequestSchema.validate({ ...SIGN_UP, code }), code).toBe(accepted);
    }
  });

  it("asks for the code with the address and the invite alone", () => {
    expect(
      signUpCodeRequestSchema.validate({ email: SIGN_UP.email, inviteCode: SIGN_UP.inviteCode }),
    ).toBe(true);
    expect(signUpCodeRequestSchema.validate({ ...SIGN_UP })).toBe(false);
  });

  it("refuses a blank name or address and a field it does not know", () => {
    expect(signUpRequestSchema.validate({ ...SIGN_UP, name: "  " })).toBe(false);
    expect(signUpRequestSchema.validate({ ...SIGN_UP, email: "" })).toBe(false);
    expect(signUpRequestSchema.validate({ ...SIGN_UP, rememberMe: true })).toBe(false);
  });
});
