import { describe, expect, it } from "vitest";
import { formReady, returnOf } from "./sign-in-fields";

const FILLED = { email: "ada@example.com", inviteCode: "INVITE", name: "Ada" };

describe("the sign-in form's fields", () => {
  it("asks for a code from the email alone", () => {
    expect(returnOf("sign-in", "email")).toStrictEqual({ kind: "send" });
  });

  it("moves Return through name, email and invite code, and asks for a code from the invite", () => {
    expect(returnOf("sign-up", "name")).toStrictEqual({ field: "email", kind: "next" });
    expect(returnOf("sign-up", "email")).toStrictEqual({ field: "inviteCode", kind: "next" });
    expect(returnOf("sign-up", "inviteCode")).toStrictEqual({ kind: "send" });
  });

  it("is ready once the door's own fields are filled, spaces alone filling none", () => {
    expect(formReady("sign-in", { ...FILLED, inviteCode: "", name: "" })).toBe(true);
    expect(formReady("sign-in", { ...FILLED, email: "  " })).toBe(false);
    expect(formReady("sign-up", FILLED)).toBe(true);
    expect(formReady("sign-up", { ...FILLED, inviteCode: " " })).toBe(false);
    expect(formReady("sign-up", { ...FILLED, name: "" })).toBe(false);
  });
});
