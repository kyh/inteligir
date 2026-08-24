// The connectors procedures. Every write answers the WHOLE registry rather
// than the row it touched: the settings surface and `inteligir connectors
// list` both render the list, so a mutation that returned one row would make
// each caller re-read to stay honest.
//
// `GET /connectors/oauth/callback` is deliberately NOT here — the provider's
// consent page redirects a BROWSER to it, and a browser wants a page, so it
// stays a plain HTTP route (the pair-callback precedent).

import { oc } from "@orpc/contract";
import { ALREADY_EXISTS } from "../local-errors";
import {
  connectorAddRequestSchema,
  connectorOauthBeginRequestSchema,
  connectorOauthBeginResponseSchema,
  connectorOauthDisconnectRequestSchema,
  connectorRemoveRequestSchema,
  connectorsResponseSchema,
  connectorToggleRequestSchema,
  connectorUpdateRequestSchema,
} from "./connectors-schema";

export const connectorsContract = {
  list: oc.output(connectorsResponseSchema),

  add: oc
    .input(connectorAddRequestSchema)
    .output(connectorsResponseSchema)
    .errors({ ALREADY_EXISTS }),

  update: oc
    .input(connectorUpdateRequestSchema)
    .output(connectorsResponseSchema)
    .errors({ NOT_FOUND: {} }),

  remove: oc
    .input(connectorRemoveRequestSchema)
    .output(connectorsResponseSchema)
    .errors({ NOT_FOUND: {} }),

  toggle: oc
    .input(connectorToggleRequestSchema)
    .output(connectorsResponseSchema)
    .errors({ NOT_FOUND: {} }),

  /** BAD_REQUEST is a call that did not reach this server over its own
   *  loopback origin: the callback URL it would compose names nowhere. */
  oauthBegin: oc
    .input(connectorOauthBeginRequestSchema)
    .output(connectorOauthBeginResponseSchema)
    .errors({ BAD_REQUEST: {}, NOT_FOUND: {} }),

  oauthDisconnect: oc
    .input(connectorOauthDisconnectRequestSchema)
    .output(connectorsResponseSchema)
    .errors({ NOT_FOUND: {} }),
};
