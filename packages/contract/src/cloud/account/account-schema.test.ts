import { describe, expect, it } from "vitest";
import {
  deleteAccountRequestSchema,
  deviceSignUpRequestSchema,
  signUpRequestSchema,
} from "./account-schema";
import {
  DEVICE_CREDENTIAL_PATTERN,
  DEVICE_NAME_MAX_LENGTH,
  deviceLoginRequestSchema,
  deviceLoginResponseSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "../device/device-schema";

describe("device login", () => {
  const LOGIN = {
    deviceName: "Laptop",
    email: "owner@example.test",
    password: "correct horse battery",
  };

  it("folds the email the way the account stores it, and trims what a human pastes", () => {
    const parsed = deviceLoginRequestSchema.parse({
      ...LOGIN,
      deviceName: "  Kaiyu's MacBook ",
      email: "  Owner@Example.TEST ",
    });
    expect(parsed.email).toBe("owner@example.test");
    expect(parsed.deviceName).toBe("Kaiyu's MacBook");
    expect(parsed.password).toBe("correct horse battery");
  });

  it("refuses what is not an address, and never trims a password", () => {
    expect(deviceLoginRequestSchema.validate({ ...LOGIN, email: "owner" })).toBe(false);
    expect(deviceLoginRequestSchema.parse({ ...LOGIN, password: " padded pw " }).password).toBe(
      " padded pw ",
    );
  });

  it("bounds the password to better auth's own window", () => {
    expect(
      deviceLoginRequestSchema.validate({
        ...LOGIN,
        password: "x".repeat(PASSWORD_MIN_LENGTH - 1),
      }),
    ).toBe(false);
    expect(
      deviceLoginRequestSchema.validate({
        ...LOGIN,
        password: "x".repeat(PASSWORD_MAX_LENGTH + 1),
      }),
    ).toBe(false);
    expect(
      deviceLoginRequestSchema.validate({ ...LOGIN, password: "x".repeat(PASSWORD_MAX_LENGTH) }),
    ).toBe(true);
  });

  it("bounds the device name and refuses a field it does not know", () => {
    expect(
      deviceLoginRequestSchema.validate({
        ...LOGIN,
        deviceName: "x".repeat(DEVICE_NAME_MAX_LENGTH + 1),
      }),
    ).toBe(false);
    expect(deviceLoginRequestSchema.validate({ ...LOGIN, deviceName: "  " })).toBe(false);
    expect(deviceLoginRequestSchema.validate({ ...LOGIN, rememberMe: true })).toBe(false);
  });

  it("pins the credential shape the server mints, and the answer that carries it", () => {
    expect(DEVICE_CREDENTIAL_PATTERN.test(`igd_${"a".repeat(64)}`)).toBe(true);
    expect(DEVICE_CREDENTIAL_PATTERN.test(`igd_${"a".repeat(63)}`)).toBe(false);
    expect(DEVICE_CREDENTIAL_PATTERN.test("not-a-credential")).toBe(false);
    const answer = {
      credential: `igd_${"a".repeat(64)}`,
      deviceId: "dev_1",
      email: "owner@example.test",
      userId: "user_1",
    };
    expect(deviceLoginResponseSchema.parse(answer)).toEqual(answer);
    expect(deviceLoginResponseSchema.parse({ ...answer, token: "x" })).toStrictEqual(answer);
    const accountless = { credential: answer.credential, deviceId: answer.deviceId };
    expect(deviceLoginResponseSchema.validate(accountless)).toBe(false);
  });

  it("asks the password again to delete the account, and nothing else", () => {
    expect(deleteAccountRequestSchema.parse({ password: " spaces kept " })).toStrictEqual({
      password: " spaces kept ",
    });
    expect(deleteAccountRequestSchema.validate({ password: "short" })).toBe(false);
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

  it("bounds the password to the window device login and better auth hold", () => {
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

  it("folds the app's address the way login does, and asks for the device's name", () => {
    expect(
      deviceSignUpRequestSchema.parse({
        ...SIGN_UP,
        deviceName: " Laptop ",
        email: " Owner@Example.TEST ",
      }),
    ).toStrictEqual({ ...SIGN_UP, deviceName: "Laptop" });
    expect(deviceSignUpRequestSchema.validate(SIGN_UP)).toBe(false);
    expect(
      deviceSignUpRequestSchema.validate({ ...SIGN_UP, deviceName: "L", email: "not-an-address" }),
    ).toBe(false);
  });
});
