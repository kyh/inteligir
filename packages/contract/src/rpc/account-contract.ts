import { z } from "zod";

import { InvalidCredentialsError, NotFoundError, signedBase } from "./v1-errors";
import {
  deleteAccountRequestSchema,
  deleteAccountResponseSchema,
  listDevicesResponseSchema,
  revokeDeviceRequestSchema,
  revokeDeviceResponseSchema,
} from "../account/account-schema";

const assistantSchema = z.object({
  clientName: z.string(),
  createdAt: z.number().int().nonnegative(),
  grantId: z.string().min(1),
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

  delete: signedBase
    .errors({ [InvalidCredentialsError.code]: InvalidCredentialsError })
    .input(deleteAccountRequestSchema)
    .output(deleteAccountResponseSchema),

  assistants: {
    list: signedBase.output(z.object({ assistants: z.array(assistantSchema) })),
    revoke: signedBase
      .errors({ [NotFoundError.code]: NotFoundError })
      .input(z.strictObject({ grantId: z.string().min(1) }))
      .output(z.object({ revoked: z.literal(true) })),
  },
};
