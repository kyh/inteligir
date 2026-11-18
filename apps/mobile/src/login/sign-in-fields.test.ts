import { describe, expect, it } from "vitest";
import { formReady, returnOf } from "./sign-in-fields";

const FILLED = { email: "ada@example.com", inviteCode: "INVITE", name: "Ada", password: "pw" };

describe("the sign-in form's fields", () => {
  it("moves Return from email to password, and sends from the password", () => {
    expect(returnOf("sign-in", "email")).toStrictEqual({ field: "password", kind: "next" });
    expect(returnOf("sign-in", "password")).toStrictEqual({ kind: "send" });
  });

  it("moves Return through name, email, password and invite code, and sends from the code", () => {
    expect(returnOf("sign-up", "name")).toStrictEqual({ field: "email", kind: "next" });
    expect(returnOf("sign-up", "email")).toStrictEqual({ field: "password", kind: "next" });
    expect(returnOf("sign-up", "password")).toStrictEqual({ field: "inviteCode", kind: "next" });
    expect(returnOf("sign-up", "inviteCode")).toStrictEqual({ kind: "send" });
  });

  it("is ready once the door's own fields are filled, spaces alone filling none but the password", () => {
    expect(formReady("sign-in", { ...FILLED, inviteCode: "", name: "" })).toBe(true);
    expect(formReady("sign-in", { ...FILLED, email: "  " })).toBe(false);
    expect(formReady("sign-in", { ...FILLED, password: " " })).toBe(true);
    expect(formReady("sign-up", FILLED)).toBe(true);
    expect(formReady("sign-up", { ...FILLED, inviteCode: " " })).toBe(false);
    expect(formReady("sign-up", { ...FILLED, name: "" })).toBe(false);
  });
});
