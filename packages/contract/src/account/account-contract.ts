// The account's procedures, which the Worker answers itself on `/v1/rpc/account` (the library's go
// on to the account's cell): the account's devices, each a signed-in session, its deletion, the
// ticket its socket opens with and the assistants it has let in. Signing in and out is Better
// Auth's own, on `/api/auth`.

import { z } from "zod";

import { InvalidCredentialsError, NotFoundError, signedBase } from "../v1-errors";
import {
  deleteAccountRequestSchema,
  deleteAccountResponseSchema,
  listDevicesResponseSchema,
  revokeDeviceRequestSchema,
  revokeDeviceResponseSchema,
} from "./account-schema";

// an assistant the person let into their library through the connector's consent page
const assistantSchema = z.object({
  clientName: z.string(),
  createdAt: z.number().int().nonnegative(),
  grantId: z.string().min(1),
  // `library` reads and changes, `library:read` only reads
  scopes: z.array(z.string()),
});

export const accountContract = {
  devices: {
    list: signedBase.output(listDevicesResponseSchema),
    revoke: signedBase
      .errors({ [NotFoundError.code]: NotFoundError })
      .input(revokeDeviceRequestSchema)
      .output(revokeDeviceResponseSchema),
  },

  // the password is asked again: a stolen session alone must not end the account
  delete: signedBase
    .errors({ [InvalidCredentialsError.code]: InvalidCredentialsError })
    .input(deleteAccountRequestSchema)
    .output(deleteAccountResponseSchema),

  // a short-lived ticket the account's socket opens with, since a browser's socket carries no
  // header the session could ride
  socketTicket: signedBase.output(
    z.object({ expiresAt: z.number().int().nonnegative(), ticket: z.string().min(1) }),
  ),

  assistants: {
    list: signedBase.output(z.object({ assistants: z.array(assistantSchema) })),
    revoke: signedBase
      .errors({ [NotFoundError.code]: NotFoundError })
      .input(z.strictObject({ grantId: z.string().min(1) }))
      .output(z.object({ revoked: z.literal(true) })),
  },
};
