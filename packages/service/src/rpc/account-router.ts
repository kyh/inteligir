// The account's rows: its devices, each one of its sessions, and its deletion with the password
// asked again. Their cores are `../auth/session-devices` and `../auth/delete-account`; signing in
// and out is Better Auth's own.

import { getAuth } from "../auth/auth";
import { deleteAccountUnderSession } from "../auth/delete-account";
import { listSessionDevices, revokeSessionDevice } from "../auth/session-devices";
import { spendDeleteBudget } from "../rate-limit";
import { os } from "./orpc";

export const accountRouter = {
  delete: os.account.delete.handler(async ({ context, errors, input }) => {
    if (!(await spendDeleteBudget(context.principal.actor.sessionId))) {
      throw errors.TOO_MANY_REQUESTS();
    }
    const deletion = await deleteAccountUnderSession(context.headers, input.password);
    switch (deletion) {
      case "signed-out": {
        throw errors.UNAUTHORIZED();
      }
      case "invalid-credentials": {
        throw errors.INVALID_CREDENTIALS();
      }
      case "deleted": {
        return { deleted: true as const };
      }
      // no default
    }
  }),
  devices: {
    list: os.account.devices.list.handler(async ({ context }) => {
      const { accountId, actor } = context.principal;
      return { devices: await listSessionDevices(accountId, actor.sessionId) };
    }),
    // the session by that id, among the account's own alone
    revoke: os.account.devices.revoke.handler(async ({ context, errors, input }) => {
      const { internalAdapter } = await getAuth().$context;
      const revoked = await revokeSessionDevice(internalAdapter, {
        id: input.id,
        userId: context.principal.accountId,
      });
      if (!revoked) {
        throw errors.NOT_FOUND();
      }
      return { revoked: true as const };
    }),
  },
};
