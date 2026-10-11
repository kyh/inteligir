import {
  ackCapturesResponseSchema,
  CAPTURE_API_PATHS,
  captureResponseSchema,
  claimCapturesResponseSchema,
} from "@repo/contract/cloud/captures/captures-schema";
import { createCloudClient } from "@repo/contract/cloud/client";
import type { CloudFetch } from "@repo/contract/cloud/client";
import {
  DEVICE_API_PATHS,
  revokeDeviceResponseSchema,
} from "@repo/contract/cloud/device/device-schema";
import {
  ackDispatchesResponseSchema,
  cancelDispatchResponseSchema,
  claimDispatchesResponseSchema,
  closeApprovalResponseSchema,
  createDispatchResponseSchema,
  DISPATCH_API_PATHS,
  dispatchStatusResponseSchema,
  listApprovalsResponseSchema,
  openApprovalResponseSchema,
} from "@repo/contract/cloud/dispatch/dispatch-schema";
import { cloudErrorSchema } from "@repo/contract/cloud/errors";
import { INBOX_SCENARIOS } from "@repo/contract/cloud/test-support/inbox-scenarios";
import { runInDurableObject, SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { threadSyncStub } from "../sync/routes";
import { emitted, floorBuild, loginDevice, ORIGIN, signUpUser, userIdOf } from "./cloud-helpers";

// what each route the table calls declares it answers, so every answer is held to exactly that
const DECLARED_ANSWERS = new Map<string, z.ZodType>([
  [CAPTURE_API_PATHS.ack, ackCapturesResponseSchema],
  [CAPTURE_API_PATHS.capture, captureResponseSchema],
  [CAPTURE_API_PATHS.claim, claimCapturesResponseSchema],
  [DEVICE_API_PATHS.revoke, revokeDeviceResponseSchema],
  [DISPATCH_API_PATHS.ack, ackDispatchesResponseSchema],
  [DISPATCH_API_PATHS.approval, openApprovalResponseSchema],
  [DISPATCH_API_PATHS.approvalClose, closeApprovalResponseSchema],
  [DISPATCH_API_PATHS.approvals, listApprovalsResponseSchema],
  [DISPATCH_API_PATHS.cancel, cancelDispatchResponseSchema],
  [DISPATCH_API_PATHS.claim, claimDispatchesResponseSchema],
  [DISPATCH_API_PATHS.dispatch, createDispatchResponseSchema],
  [DISPATCH_API_PATHS.status, dispatchStatusResponseSchema],
]);

interface Answer {
  route: string;
  ok: boolean;
  text: string;
}

const declaredFor = ({ ok, route }: Answer): z.ZodType => {
  const schema = ok ? DECLARED_ANSWERS.get(route) : cloudErrorSchema;
  if (schema === undefined) {
    throw new Error(`the table called ${route}, which DECLARED_ANSWERS does not name`);
  }
  return schema;
};

let accounts = 0;

// a row that fills a cap makes a hundred calls through the Worker
const ROW_TIMEOUT_MS = 30_000;

// the table the CLI's suites run against their fake: a row failing here is the deployed rule
describe("the Worker's inboxes", () => {
  it.each(INBOX_SCENARIOS)(
    "$name",
    async ({ expected, run }) => {
      const { bearer } = await signUpUser(`inbox-scenario-${(accounts += 1)}@example.test`);
      const stub = threadSyncStub(env, await userIdOf(bearer));
      const answers: Answer[] = [];
      // the client strips what it does not declare, so the answers are read again after the run
      const recorded: CloudFetch = async (input, init) => {
        const response = await SELF.fetch(input, init);
        answers.push({
          ok: response.ok,
          route: new URL(input).pathname,
          text: await response.clone().text(),
        });
        return response;
      };
      const observed = await run({
        lapseClaims: async () => {
          await runInDurableObject(stub, (_instance, state) => {
            state.storage.sql.exec("UPDATE dispatches SET claimed_at = 0");
            state.storage.sql.exec("UPDATE captures SET claimed_at = 0");
          });
        },
        signIn: async (name) => {
          const { credential, deviceId } = await loginDevice(bearer, name);
          return {
            client: createCloudClient({
              baseUrl: ORIGIN,
              build: floorBuild(),
              credential,
              fetch: recorded,
            }),
            deviceId,
          };
        },
      });
      expect(observed).toEqual(expected);
      for (const answer of answers) {
        emitted(declaredFor(answer), answer.text);
      }
    },
    ROW_TIMEOUT_MS,
  );
});
