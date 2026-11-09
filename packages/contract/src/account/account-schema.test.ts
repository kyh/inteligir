import { describe, expect, it } from "vitest";
import {
  deleteAccountRequestSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  signUpRequestSchema,
} from "./account-schema";

describe("account deletion request", () => {
  it("asks the password again to delete the account, and nothing else", () => {
    expect(deleteAccountRequestSchema.parse({ password: " spaces kept " })).toStrictEqual({
      password: " spaces kept ",
    });
    expect(deleteAccountRequestSchema.validate({ password: "short" })).toBe(false);
    expect(
      deleteAccountRequestSchema.validate({ password: "x".repeat(PASSWORD_MAX_LENGTH + 1) }),
    ).toBe(false);
    expect(deleteAccountRequestSchema.validate({ email: "x", password: "the password" })).toBe(
      false,
    );
  });
});

describe("invite sign-up request", () => {
  const SIGN_UP = {
    email: "owner@example.test",
    inviteCode: "INVITE-1",
    name: "Owner",
    password: "correct horse battery",
  };

  it("trims every field but the password", () => {
    expect(
      signUpRequestSchema.parse({
        email: " owner@example.test ",
        inviteCode: " INVITE-1 ",
        name: " Owner ",
        password: " padded pw ",
      }),
    ).toStrictEqual({ ...SIGN_UP, password: " padded pw " });
  });

  it("bounds the password to the window better auth holds", () => {
    for (const [length, accepted] of [
      [PASSWORD_MIN_LENGTH - 1, false],
      [PASSWORD_MIN_LENGTH, true],
      [PASSWORD_MAX_LENGTH, true],
      [PASSWORD_MAX_LENGTH + 1, false],
    ] as const) {
      const password = "x".repeat(length);
      expect(signUpRequestSchema.validate({ ...SIGN_UP, password }), String(length)).toBe(accepted);
    }
  });

  it("refuses a blank name or address and a field it does not know", () => {
    expect(signUpRequestSchema.validate({ ...SIGN_UP, name: "  " })).toBe(false);
    expect(signUpRequestSchema.validate({ ...SIGN_UP, email: "" })).toBe(false);
    expect(signUpRequestSchema.validate({ ...SIGN_UP, rememberMe: true })).toBe(false);
  });
});
