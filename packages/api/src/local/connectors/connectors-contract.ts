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
} from "./connectors-schema";

export const connectorsContract = {
  list: oc.output(connectorsResponseSchema),

  add: oc
    .input(connectorAddRequestSchema)
    .output(connectorsResponseSchema)
    .errors({ ALREADY_EXISTS }),

  remove: oc
    .input(connectorRemoveRequestSchema)
    .output(connectorsResponseSchema)
    .errors({ NOT_FOUND: {} }),

  toggle: oc
    .input(connectorToggleRequestSchema)
    .output(connectorsResponseSchema)
    .errors({ NOT_FOUND: {} }),

  // BAD_REQUEST: the call did not arrive over this server's own loopback origin, so the callback URL it would compose names nowhere
  oauthBegin: oc
    .input(connectorOauthBeginRequestSchema)
    .output(connectorOauthBeginResponseSchema)
    .errors({ BAD_REQUEST: {}, NOT_FOUND: {} }),

  oauthDisconnect: oc
    .input(connectorOauthDisconnectRequestSchema)
    .output(connectorsResponseSchema)
    .errors({ NOT_FOUND: {} }),
};
