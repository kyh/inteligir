import { oc } from "@orpc/contract";
import { ALREADY_EXISTS, PROVIDER_UNAVAILABLE } from "../local-errors";
import {
  connectorAddRequestSchema,
  connectorRowRequestSchema,
  connectorsResponseSchema,
} from "./connectors-schema";

// every row answers the default agent's whole list. PROVIDER_UNAVAILABLE: its vendor would not
// answer, or its config could not be read, and the message is the vendor's or names the file
export const connectorsContract = {
  add: oc
    .input(connectorAddRequestSchema)
    .output(connectorsResponseSchema)
    .errors({ ALREADY_EXISTS, PROVIDER_UNAVAILABLE }),

  list: oc.output(connectorsResponseSchema).errors({ PROVIDER_UNAVAILABLE }),

  remove: oc
    .input(connectorRowRequestSchema)
    .output(connectorsResponseSchema)
    .errors({ NOT_FOUND: {}, PROVIDER_UNAVAILABLE }),

  // answers once the vendor's sign-in is running, which the row then reads as pending; one already
  // running for the row is left to run. BAD_REQUEST: a row that is not a URL signs in to nothing
  signIn: oc
    .input(connectorRowRequestSchema)
    .output(connectorsResponseSchema)
    .errors({ BAD_REQUEST: {}, NOT_FOUND: {}, PROVIDER_UNAVAILABLE }),
};
