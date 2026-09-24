import { describe, expect, it } from "vitest";

import { CONNECTION_FAILED, settleAuthSubmit } from "../auth-shell";

const FORM = new FormData();

// what a browser's fetch does with no network
const offline = async (): Promise<string | null> => {
  throw new TypeError("Failed to fetch");
};

describe("an auth form's submit", () => {
  it("settles an offline submit with a message, so the form comes back usable", async () => {
    await expect(settleAuthSubmit(offline, FORM)).resolves.toBe(CONNECTION_FAILED);
  });

  it("shows what a refusal said, and nothing once the submit went through", async () => {
    await expect(settleAuthSubmit(async () => "Wrong email or password.", FORM)).resolves.toBe(
      "Wrong email or password.",
    );
    await expect(settleAuthSubmit(async () => null, FORM)).resolves.toBeNull();
  });
});
