// The local cloud routes, registered against the contract rows. The runtime
// decides; this layer only turns what it decided into a response.
//
// There is no route here that takes a pairing CODE. Beginning an approval is
// the only pairing verb a client can call, and the code that eventually lands
// arrives at `GET /pair/callback` — a browser-facing route that is deliberately
// not a row in this table (see `pair-callback.ts`).

import { pairCallbackUrlFor } from "./pair-callback";
import type { BeginPairArgs, CloudRuntime } from "./sync-runtime";
import { cloudRoutes } from "@repo/server-contract/cloud";
import { API_ERROR_STATUS, type ApiErrorResponse } from "@repo/server-contract/errors";
import type { TypedRoutesRegistrars } from "@repo/typed-routes/typed-routes";

export function registerCloudRoutes(
  registrars: Pick<TypedRoutesRegistrars, "get" | "post">,
  runtime: CloudRuntime,
): void {
  const { get, post } = registrars;

  get(cloudRoutes.status, (c) => c.json(runtime.status()));

  post(cloudRoutes.pairBegin, async (c, body) => {
    // The address the browser will be sent back to, taken from the origin this
    // caller actually reached — so a probed dev port is the port the redirect
    // names. A request that did not arrive on one of this app's own loopback
    // origins has no callback to offer, and gets told so rather than handed a
    // URL pointing somewhere else.
    const callbackUrl = pairCallbackUrlFor(c.req.header("host"));
    if (callbackUrl === null) {
      const refusal: ApiErrorResponse = {
        error: "invalid_request",
        message: "Pairing must be started from this app's own address (127.0.0.1 or localhost).",
      };
      return c.json(refusal, API_ERROR_STATUS.invalid_request);
    }
    const begin: BeginPairArgs = { callbackUrl, openBrowser: body.openBrowser };
    if (body.deviceName !== undefined) begin.deviceName = body.deviceName;
    return c.json(await runtime.beginPair(begin));
  });

  post(cloudRoutes.unpair, (c) => c.json(runtime.unpair()));

  post(cloudRoutes.syncNow, async (c) => c.json(await runtime.syncNow()));
}
