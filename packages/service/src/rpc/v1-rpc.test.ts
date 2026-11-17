// `/v1/rpc` past admission: a path no row serves, a call over the body cap, a credential no CORS
// header hands another page, and a throw answered in the wire's own protocol.

import { dbSuite } from "@repo/db/test-database";
import { afterEach, expect, it, vi } from "vitest";

import { getAuth } from "../auth/auth";
import { signInPhone, signUpUser } from "../test-support/auth-requests";
import { buildHeaders, phoneHeaders, v1Link, v1Post } from "../test-support/v1-link";

afterEach(() => {
  vi.restoreAllMocks();
});

dbSuite("the wire past admission", () => {
  it("answers 404 for a path no row serves, and 413 for a call past the cap", async () => {
    await signUpUser("wire-paths@example.test");
    const phone = phoneHeaders(await signInPhone("wire-paths@example.test"));
    const missing = await v1Post("account/no-such-row", phone);
    expect(missing.status).toBe(404);

    const huge = await v1Post(
      "account/delete",
      phone,
      JSON.stringify({ json: { password: "x".repeat(70_000) } }),
    );
    expect(huge.status).toBe(413);
  });

  it("hands no other origin an answer", async () => {
    await signUpUser("wire-cors@example.test");
    const phone = phoneHeaders(await signInPhone("wire-cors@example.test"));
    for (const origin of ["https://elsewhere.example", "tauri://localhost"]) {
      const answer = await v1Post("account/devices/list", { ...phone, origin });
      expect(answer.status).toBe(200);
      expect(answer.headers.get("access-control-allow-origin"), origin).toBeNull();
    }
  });

  it("answers a throw as the protocol's fault, never Next's own 500, and logs it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(getAuth().api, "getSession").mockRejectedValueOnce(new Error("Postgres is down"));
    const phone = v1Link({ ...buildHeaders(), cookie: "any", "expo-origin": "inteligir://" });
    await expect(phone.refusalOf(phone.account.devices.list())).resolves.toStrictEqual({
      code: "INTERNAL_SERVER_ERROR",
      defined: false,
      status: 500,
    });
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ event: "unhandled-error", message: "Postgres is down" }),
    );
  });
});
