import { describe, expect, it } from "vitest";

import { CONNECTION_FAILED, settleAuthSubmit, submitView } from "./auth-shell";

const FORM = new FormData();

const offline = async () => {
  throw new TypeError("Failed to fetch");
};

describe("an auth form's submit", () => {
  it("settles an offline submit with a message, so the form comes back usable", async () => {
    const settled = await settleAuthSubmit(offline, FORM);
    expect(submitView(settled)).toMatchObject({ busy: false, error: CONNECTION_FAILED });
  });

  it("shows what a refusal said, and stays busy once the submit went through", async () => {
    const refused = await settleAuthSubmit(async () => "Wrong email or password.", FORM);
    expect(submitView(refused)).toMatchObject({ busy: false, error: "Wrong email or password." });
    const through = await settleAuthSubmit(async () => null, FORM);
    expect(submitView(through)).toStrictEqual({ busy: true, done: true, error: null });
  });
});
