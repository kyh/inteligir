import { oc } from "@orpc/contract";
import { ALREADY_EXISTS, PROVIDER_UNAVAILABLE } from "../local-errors";
import {
  connectorAddRequestSchema,
  connectorOauthBeginRequestSchema,
  connectorOauthBeginResponseSchema,
  connectorOauthDisconnectRequestSchema,
  connectorRemoveRequestSchema,
  connectorsResponseSchema,
  connectorToggleRequestSchema,
} from "./connectors-schema";

export const connectorsContract = {
  add: oc
    .input(connectorAddRequestSchema)
    .output(connectorsResponseSchema)
    .errors({ ALREADY_EXISTS }),

  list: oc.output(connectorsResponseSchema),

  // BAD_REQUEST: the call did not arrive over this server's own loopback origin, so the callback URL it would compose names nowhere.
  // PROVIDER_UNAVAILABLE: discovery or client registration failed, and the message says which step
  oauthBegin: oc
    .input(connectorOauthBeginRequestSchema)
    .output(connectorOauthBeginResponseSchema)
    .errors({ BAD_REQUEST: {}, NOT_FOUND: {}, PROVIDER_UNAVAILABLE }),

  oauthDisconnect: oc
    .input(connectorOauthDisconnectRequestSchema)
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
};
