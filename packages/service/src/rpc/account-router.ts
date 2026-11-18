import { deploymentAgentRuntime } from "../agent/runtime";
import { getAuth } from "../auth/auth";
import { listAssistants, revokeAssistant } from "../auth/connected-assistants";
import { deleteAccountUnderSession } from "../auth/delete-account";
import { listSessionDevices, revokeSessionDevice } from "../auth/session-devices";
import { spendHolderBudget } from "../rate-limit";
import { os } from "./orpc";

export const accountRouter = {
  assistants: {
    list: os.account.assistants.list.handler(async ({ context }) => ({
      assistants: await listAssistants(context.principal.accountId),
    })),
    revoke: os.account.assistants.revoke.handler(async ({ context, errors, input }) => {
      if (!(await revokeAssistant(context.principal.accountId, input.grantId))) {
        throw errors.NOT_FOUND();
      }

      return { revoked: true as const };
    }),
  },
  delete: os.account.delete.handler(async ({ context, errors, input }) => {
    const spent = await spendHolderBudget("accountDelete", context.principal.actor.sessionId);

    if (spent.kind === "refused") {
      throw errors.TOO_MANY_REQUESTS();
    }

    const deletion = await deleteAccountUnderSession(deploymentAgentRuntime(), {
      accountId: context.principal.accountId,
      headers: context.headers,
      password: input.password,
    });

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

      default: {
        throw new Error(`unexpected ${String(deletion satisfies never)}`);
      }
    }
  }),
  devices: {
    list: os.account.devices.list.handler(async ({ context }) => {
      const { accountId, actor } = context.principal;

      return { devices: await listSessionDevices(accountId, actor.sessionId) };
    }),
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
