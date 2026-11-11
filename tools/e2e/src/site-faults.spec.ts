import { expect } from "@playwright/test";
import { clientBuildHeaders } from "@repo/contract/client-build";
import { V1_BLOBS_PATH } from "@repo/contract/library/library-blobs";
import { V1_RPC_PATH } from "@repo/contract/v1";
import { test } from "./fixtures";

// a floor that is no version throws in each door that reads it, before any procedure runs
test.use({ cloudOptions: { vars: { MIN_CLIENT_BUILD: "no-version" } } });

test("a door that throws answers in its own protocol, never Start's own JSON 500", async ({
  cloud,
  request,
}) => {
  const headers = clientBuildHeaders({ platform: "mobile", version: cloud.build });
  const call = await request.post(`${cloud.origin}${V1_RPC_PATH}/account/devices/list`, {
    data: {},
    headers,
  });
  expect(call.status()).toBe(500);
  expect(await call.text()).toContain('"code":"INTERNAL_SERVER_ERROR"');
  const file = await request.get(`${cloud.origin}${V1_BLOBS_PATH}/${"a".repeat(64)}`, { headers });
  expect([file.status(), await file.text()]).toEqual([500, "internal error"]);
});
