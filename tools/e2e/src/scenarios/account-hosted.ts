import { isDefinedError, safe } from "@orpc/client";
import { expect, expectEq } from "../harness/assert";
import { OWNER } from "../harness/cloud-account";
import { E2E_INVITE_CODE, WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import type { AppInstance } from "../harness/instance";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";

const IDENTITY_DEADLINE_MS = 15_000;
const POLL_INTERVAL_MS = 200;

// the account's email lands a beat after the credential: the status answers it once learned.
const untilSignedInAs = async (app: AppInstance, label: string): Promise<void> => {
  await pollUntil(
    async () => await app.api.cloud.status(),
    (status) => status.state === "signed-in" && status.accountEmail === OWNER.email,
    {
      deadlineMs: IDENTITY_DEADLINE_MS,
      describe: (status) =>
        `${label} never answered signed in as ${OWNER.email}: ${JSON.stringify(status)}`,
      intervalMs: POLL_INTERVAL_MS,
    },
  );
};

export const accountHosted: Scenario = {
  description:
    "an account created in the app signs that device in and spends its invite; a second device signs in with the same email and password, and the first lists and revokes it",
  name: "account-hosted",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const worker = await ctx.cloudWorker();

    // each vault syncs to a bare remote of its own: the account's hosted one would meet B's
    // history as an unrelated one, a conflict beside what this scenario proves.
    const boot = async (name: string): Promise<AppInstance> =>
      await ctx.boot({
        extraEnv: { INTELIGIR_CLOUD_URL: worker.origin, INTELIGIR_SYNC_INTERVAL_MS: "0" },
        name,
        vaultRemote: await ctx.bareRemote(name),
      });
    const a = await boot("a");
    const b = await boot("b");

    ctx.log("A creates the account with the invite code, through the production route");
    const created = await a.api.cloud.signUp({
      ...OWNER,
      deviceName: "E2E Device A",
      inviteCode: E2E_INVITE_CODE,
      name: "E2E Owner",
    });
    expect(created.state === "signed-in", `A's sign-up answered ${created.state}`);
    await untilSignedInAs(a, "A");

    ctx.log("the invite is spent: B cannot create another account with it");
    const [refusal] = await safe(
      b.api.cloud.signUp({
        deviceName: "E2E Device B",
        email: "e2e-second@inteligir.local",
        inviteCode: E2E_INVITE_CODE,
        name: "E2E Second",
        password: OWNER.password,
      }),
    );
    expect(
      isDefinedError(refusal) && refusal.code === "FORBIDDEN",
      `reusing the invite answered ${isDefinedError(refusal) ? refusal.code : String(refusal)}`,
    );
    const refused = await b.api.cloud.status();
    expect(refused.state === "signed-out", `B after the refusal is ${refused.state}`);

    ctx.log("B signs in to the account A created, with its email and password");
    const joined = await b.api.cloud.login({ ...OWNER, deviceName: "E2E Device B" });
    expect(joined.state === "signed-in", `B's login answered ${joined.state}`);
    await untilSignedInAs(b, "B");

    ctx.log("A lists the account's devices with its own credential: itself, marked, and B");
    const listed = await a.api.cloud.devices();
    expectEq(
      listed.devices.map(({ current, name }) => ({ current, name })),
      [
        { current: true, name: "E2E Device A" },
        { current: false, name: "E2E Device B" },
      ],
      "A's device list",
    );
    const bRow = listed.devices.find((device) => !device.current);
    expect(bRow?.id === joined.deviceId, `A listed B as ${JSON.stringify(bRow)}`);

    ctx.log("A revokes B");
    expectEq(
      await a.api.cloud.revokeDevice({ deviceId: joined.deviceId }),
      { revoked: true },
      "A's revoke of B",
    );
    const after = await a.api.cloud.devices();
    expectEq(
      after.devices.map((device) => device.name),
      ["E2E Device A"],
      "A's device list after the revoke",
    );

    ctx.log("B's next request is refused: B reaches unauthorized");
    await pollUntil(
      async () => {
        await b.api.cloud.syncNow();
        return await b.api.cloud.status();
      },
      (status) => status.state === "unauthorized",
      {
        deadlineMs: IDENTITY_DEADLINE_MS,
        describe: (status) => `B never answered unauthorized: ${JSON.stringify(status)}`,
        intervalMs: POLL_INTERVAL_MS,
      },
    );
    const stillA = await a.api.cloud.status();
    expect(stillA.state === "signed-in", `A after revoking B is ${stillA.state}`);
  },
};
