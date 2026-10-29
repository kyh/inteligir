// The account's procedures, which the Worker answers itself on `/v1/rpc/account` (the library's go
// on to the account's cell): a device's credential and its sign-in, the account's devices, its
// deletion, the ticket its socket opens with and the assistants it has let in.

import { z } from "zod";

import {
  AccountExistsError,
  DeviceLimitError,
  InvalidCredentialsError,
  InviteRefusedError,
  NotFoundError,
  publicBase,
  signedBase,
} from "../v1-errors";
import {
  deleteAccountRequestSchema,
  deleteAccountResponseSchema,
  deviceSignUpRequestSchema,
} from "./account-schema";
import {
  deviceLoginRequestSchema,
  deviceLoginResponseSchema,
  listDevicesResponseSchema,
  revokeDeviceRequestSchema,
  revokeDeviceResponseSchema,
} from "../device/device-schema";

// an assistant the person let into their library through the connector's consent page
const assistantSchema = z.object({
  clientName: z.string(),
  createdAt: z.number().int().nonnegative(),
  grantId: z.string().min(1),
  // `library` reads and changes, `library:read` only reads
  scopes: z.array(z.string()),
});

export const accountContract = {
  // email and password for this device's own credential
  signIn: publicBase
    .errors({
      [DeviceLimitError.code]: DeviceLimitError,
      [InvalidCredentialsError.code]: InvalidCredentialsError,
    })
    .input(deviceLoginRequestSchema)
    .output(deviceLoginResponseSchema),

  // the account made with an invite code, answering this device's credential as a sign-in does
  signUp: publicBase
    .errors({
      [AccountExistsError.code]: AccountExistsError,
      [InviteRefusedError.code]: InviteRefusedError,
    })
    .input(deviceSignUpRequestSchema)
    .output(deviceLoginResponseSchema),

  // revokes the credential that asks
  signOut: signedBase.output(revokeDeviceResponseSchema),

  devices: {
    list: signedBase.output(listDevicesResponseSchema),
    revoke: signedBase
      .errors({ [NotFoundError.code]: NotFoundError })
      .input(revokeDeviceRequestSchema)
      .output(revokeDeviceResponseSchema),
  },

  // the password is asked again: a stolen credential alone must not end the account
  delete: signedBase
    .errors({ [InvalidCredentialsError.code]: InvalidCredentialsError })
    .input(deleteAccountRequestSchema)
    .output(deleteAccountResponseSchema),

  // a short-lived ticket the account's socket opens with, since a browser's socket carries no
  // header the credential could ride
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
