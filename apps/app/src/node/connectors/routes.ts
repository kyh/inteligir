// The connector routes, registered against the contract rows. The service
// decides; this layer only says which refusal class each throw answers with.
// Each write switches EXHAUSTIVELY over the refusal set — including the class
// its own row does not declare, which rethrows into the API's generic 500, so
// a new class arriving is decided per route rather than defaulted.

import { CONNECTOR_OAUTH_CALLBACK_PATH, connectorRoutes } from "@repo/server-contract/connectors";
import { API_ERROR_STATUS, type ApiErrorResponse } from "@repo/server-contract/errors";
import type { TypedRoutesRegistrars } from "@repo/typed-routes/typed-routes";
import { loopbackRequestOrigin } from "../browser-request-guard";
import type { OpenExternalUrl } from "../cloud/browser-opener";
import { ConnectorConflictError, type ConnectorsService } from "./connectors-service";
import type { ConnectorOauthFlow } from "./oauth-flow";

function refusalFor(cause: unknown): ConnectorConflictError | null {
  return cause instanceof ConnectorConflictError ? cause : null;
}

/** The callback URL for a request that reached this app's own loopback origin
 *  — the pair-callback rule: the PORT is the caller's own Host header's fact,
 *  never the configured guess. */
function oauthCallbackUrlFor(host: string | undefined): string | null {
  const origin = loopbackRequestOrigin(host);
  return origin === null ? null : `${origin}${CONNECTOR_OAUTH_CALLBACK_PATH}`;
}

export function registerConnectorRoutes(
  registrars: Pick<TypedRoutesRegistrars, "get" | "post">,
  service: ConnectorsService,
  oauth: ConnectorOauthFlow,
  openExternalUrl: OpenExternalUrl,
): void {
  const { get, post } = registrars;

  get(connectorRoutes.list, (c) => c.json({ servers: service.list() }));

  post(connectorRoutes.add, (c, body) => {
    try {
      return c.json({ servers: service.add(body) });
    } catch (error) {
      const refusal = refusalFor(error);
      switch (refusal?.kind) {
        case "already-exists":
          return c.json(
            { error: "already_exists", message: refusal.message },
            API_ERROR_STATUS.already_exists,
          );
        case "not-found":
        case undefined:
          throw error;
      }
    }
  });

  post(connectorRoutes.update, (c, body) => {
    try {
      return c.json({ servers: service.update(body) });
    } catch (error) {
      const refusal = refusalFor(error);
      switch (refusal?.kind) {
        case "not-found":
          return c.json(
            { error: "not_found", message: refusal.message },
            API_ERROR_STATUS.not_found,
          );
        case "already-exists":
        case undefined:
          throw error;
      }
    }
  });

  post(connectorRoutes.remove, (c, body) => {
    try {
      return c.json({ servers: service.remove(body.name) });
    } catch (error) {
      const refusal = refusalFor(error);
      switch (refusal?.kind) {
        case "not-found":
          return c.json(
            { error: "not_found", message: refusal.message },
            API_ERROR_STATUS.not_found,
          );
        case "already-exists":
        case undefined:
          throw error;
      }
    }
  });

  post(connectorRoutes.toggle, (c, body) => {
    try {
      return c.json({ servers: service.toggle(body.name, body.enabled) });
    } catch (error) {
      const refusal = refusalFor(error);
      switch (refusal?.kind) {
        case "not-found":
          return c.json(
            { error: "not_found", message: refusal.message },
            API_ERROR_STATUS.not_found,
          );
        case "already-exists":
        case undefined:
          throw error;
      }
    }
  });

  post(connectorRoutes.oauthBegin, async (c, body) => {
    const callbackUrl = oauthCallbackUrlFor(c.req.header("host"));
    if (callbackUrl === null) {
      const refusal: ApiErrorResponse = {
        error: "invalid_request",
        message:
          "Authorization must be started from this app's own address (127.0.0.1 or localhost).",
      };
      return c.json(refusal, API_ERROR_STATUS.invalid_request);
    }
    try {
      const url = await oauth.begin(body.name, callbackUrl);
      // A failed open is an ordinary answer: the URL works pasted anywhere.
      const opened = body.open ? await openExternalUrl(url) : false;
      return c.json({ opened, url });
    } catch (error) {
      const refusal = refusalFor(error);
      switch (refusal?.kind) {
        case "not-found":
          return c.json(
            { error: "not_found", message: refusal.message },
            API_ERROR_STATUS.not_found,
          );
        case "already-exists":
        case undefined:
          throw error;
      }
    }
  });

  post(connectorRoutes.oauthDisconnect, (c, body) => {
    try {
      oauth.disconnect(body.name);
      return c.json({ servers: service.list() });
    } catch (error) {
      const refusal = refusalFor(error);
      switch (refusal?.kind) {
        case "not-found":
          return c.json(
            { error: "not_found", message: refusal.message },
            API_ERROR_STATUS.not_found,
          );
        case "already-exists":
        case undefined:
          throw error;
      }
    }
  });
}
