import { existsSync } from "node:fs";
import { isDefinedError, safe } from "@orpc/client";
import { deviceCredentialPath } from "inteligir/server/cloud/credential-store";
import { expect, expectEq } from "../harness/assert";
import { OWNER } from "../harness/cloud-account";
import { E2E_INVITE_CODE, WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { hostedVaultEnv } from "../harness/hosted-vault";
import type { AppInstance } from "../harness/instance";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { accountIdOf, holdingsOf, newItemId, uploadFile, v1Client } from "../harness/v1-wire";

const REVOKED_DEADLINE_MS = 15_000;

// a one-pixel PNG, the file the phone keeps in the library
const PIXEL = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

export const accountHosted: Scenario = {
  description:
    "an account created in the app (`cloud.signUp`) against a Miniflare Worker signs that instance in as it; the invite is spent, so a second sign-up with it is FORBIDDEN; a second instance signs in with the same email and password, and the first lists both devices and revokes it; a phone signs in over the one wire and writes a note and a file into the account's library cell; a wrong password deletes nothing, and the right one signs the first out and takes the cell's items, the files in R2 and the account's rows in D1 with it, after which the phone's credential reaches nothing, the password signs nothing in and the invite stays spent",
  name: "account-hosted",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const worker = await ctx.cloudWorker();

    // each vault syncs to a bare remote of its own: the account's hosted one would meet B's
    // history as an unrelated one, a conflict beside what this scenario proves.
    const boot = async (name: string): Promise<AppInstance> =>
      await ctx.boot({
        extraEnv: hostedVaultEnv(worker.origin),
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
    expect(
      created.state === "signed-in" && created.accountEmail === OWNER.email,
      `A's sign-up answered ${JSON.stringify(created)}`,
    );

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
    expect(
      joined.state === "signed-in" && joined.accountEmail === OWNER.email,
      `B's login answered ${JSON.stringify(joined)}`,
    );

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
        // any request under B's credential hears the revocation; the refusal itself is expected
        await safe(b.api.cloud.devices());
        return await b.api.cloud.status();
      },
      (status) => status.state === "unauthorized",
      {
        deadlineMs: REVOKED_DEADLINE_MS,
        describe: (status) => `B never answered unauthorized: ${JSON.stringify(status)}`,
        intervalMs: 200,
      },
    );
    const stillA = await a.api.cloud.status();
    expect(stillA.state === "signed-in", `A after revoking B is ${stillA.state}`);

    ctx.log("a phone signs in over the one wire and writes the library through it");
    const phone = await v1Client(worker, null).account.signIn({
      ...OWNER,
      deviceName: "E2E Phone",
    });
    const { library } = v1Client(worker, phone.credential);
    const { item: note } = await library.items.createNote({
      markdown: "Written over the one wire.",
      title: "From the phone",
    });
    const read = await library.items.read({ id: note.id });
    expectEq(read.view.markdown, "Written over the one wire.\n", "the phone's note read back");
    const upload = await uploadFile(worker, phone.credential, { bytes: PIXEL, type: "image/png" });
    expect(upload.status === 201, `the phone's upload answered ${String(upload.status)}`);
    const { item: file } = await library.items.createFile({
      folderId: null,
      id: newItemId(),
      name: "pixel.png",
      savedAt: Date.now(),
      sha: upload.sha,
      tags: [],
    });
    const fileRead = await library.items.read({ id: file.id });
    expect(fileRead.fields.kind === "image", `the phone's file landed as ${fileRead.fields.kind}`);
    const accountId = await accountIdOf(worker, OWNER.email);
    if (accountId === null) {
      throw new Error("the worker host found no account for the owner's email");
    }
    const held = await holdingsOf(worker, accountId);
    expect(
      held.cell.items === 2 &&
        held.cell.deleted === null &&
        held.files === 1 &&
        held.rows.users === 1,
      `the account holds ${JSON.stringify(held)}`,
    );

    ctx.log("A's deletion with a wrong password is refused, and A stays signed in");
    const [wrong] = await safe(a.api.cloud.deleteAccount({ password: "not-the-password" }));
    expect(
      isDefinedError(wrong) && wrong.code === "UNAUTHORIZED",
      `a wrong password answered ${isDefinedError(wrong) ? wrong.code : String(wrong)}`,
    );
    const kept = await a.api.cloud.status();
    expect(kept.state === "signed-in", `A after the wrong password is ${kept.state}`);

    ctx.log("A deletes the account with its password: A is signed out, its credential gone");
    const deleted = await a.api.cloud.deleteAccount({ password: OWNER.password });
    expect(deleted.state === "signed-out", `A's deletion answered ${deleted.state}`);
    expect(
      !existsSync(deviceCredentialPath(a.dataDir)),
      "A's credential file outlived the deletion",
    );

    ctx.log("the account's cell, its files in R2 and its rows in D1 went with it");
    const gone = await holdingsOf(worker, accountId);
    expect(
      gone.cell.items === 0 && gone.cell.deleted !== null,
      `the deleted account's cell holds ${JSON.stringify(gone.cell)}`,
    );
    expectEq(gone.files, 0, "the deleted account's files in R2");
    expectEq(gone.rows, { devices: 0, sessions: 0, users: 0 }, "the deleted account's rows in D1");
    const [unreachable] = await safe(library.items.list({}));
    expect(
      isDefinedError(unreachable) && unreachable.code === "UNAUTHORIZED",
      `the phone after the deletion answered ${isDefinedError(unreachable) ? unreachable.code : String(unreachable)}`,
    );

    ctx.log("the account is gone: its password signs nothing in, and its invite stays spent");
    const [login] = await safe(a.api.cloud.login({ ...OWNER, deviceName: "E2E Device A" }));
    expect(
      isDefinedError(login) && login.code === "UNAUTHORIZED",
      `signing in to the deleted account answered ${isDefinedError(login) ? login.code : String(login)}`,
    );
    const [recreated] = await safe(
      a.api.cloud.signUp({
        ...OWNER,
        deviceName: "E2E Device A",
        inviteCode: E2E_INVITE_CODE,
        name: "E2E Owner",
      }),
    );
    expect(
      isDefinedError(recreated) && recreated.code === "FORBIDDEN",
      `reusing the deleted account's invite answered ${isDefinedError(recreated) ? recreated.code : String(recreated)}`,
    );
  },
};
