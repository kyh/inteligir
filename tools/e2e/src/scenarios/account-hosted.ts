import { ORPCError, safe } from "@orpc/client";
import { expect, expectEq } from "../harness/assert";
import { OWNER } from "../harness/cloud-account";
import { E2E_INVITE_CODE, WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import type { Scenario } from "../harness/scenario";
import { accountIdOf, holdingsOf, newItemId, uploadFile, v1Client } from "../harness/v1-wire";

// a one-pixel PNG, the file the phone keeps in the library
const PIXEL = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

// the code a refusal answers, or what was answered instead
const codeOf = (error: Error | null): string =>
  error instanceof ORPCError ? error.code : `no refusal (${String(error)})`;

export const accountHosted: Scenario = {
  description:
    "an account created over the one wire with an invite code (`account.signUp`) answers device A's credential; the invite is spent, so a second sign-up with it is FORBIDDEN; device B signs in with the same email and password, A lists both devices and revokes B, whose next call is UNAUTHORIZED; a phone writes a note and a file into the account's library cell; a wrong password deletes nothing, and the right one takes the cell's items, the files in R2 and the account's rows in D1 with it, after which every credential reaches nothing, the password signs nothing in and the invite stays spent",
  name: "account-hosted",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const worker = await ctx.cloudWorker();
    const { account } = v1Client(worker, null);

    ctx.log("A creates the account with the invite code");
    const a = await account.signUp({
      ...OWNER,
      deviceName: "E2E Device A",
      inviteCode: E2E_INVITE_CODE,
      name: "E2E Owner",
    });
    expectEq(a.email, OWNER.email, "A's sign-up answers the account");
    const asA = v1Client(worker, a.credential);

    ctx.log("the invite is spent: no other account can be created with it");
    const [refusal] = await safe(
      account.signUp({
        deviceName: "E2E Device B",
        email: "e2e-second@inteligir.local",
        inviteCode: E2E_INVITE_CODE,
        name: "E2E Second",
        password: OWNER.password,
      }),
    );
    expectEq(codeOf(refusal), "FORBIDDEN", "reusing the invite");

    ctx.log("B signs in to the account A created, with its email and password");
    const b = await account.signIn({ ...OWNER, deviceName: "E2E Device B" });
    expectEq(b.email, OWNER.email, "B's sign-in answers the account");
    const asB = v1Client(worker, b.credential);

    ctx.log("A lists the account's devices with its own credential, and revokes B");
    const listed = await asA.account.devices.list();
    expectEq(
      listed.devices.map(({ id, name, revokedAt }) => ({ id, name, revoked: revokedAt !== null })),
      [
        { id: a.deviceId, name: "E2E Device A", revoked: false },
        { id: b.deviceId, name: "E2E Device B", revoked: false },
      ],
      "A's device list",
    );
    expectEq(
      await asA.account.devices.revoke({ deviceId: b.deviceId }),
      { revoked: true },
      "A's revoke of B",
    );
    const [revoked] = await safe(asB.account.devices.list());
    expectEq(codeOf(revoked), "UNAUTHORIZED", "B's next call");
    const after = await asA.account.devices.list();
    expectEq(
      after.devices.map(({ name, revokedAt }) => ({ name, revoked: revokedAt !== null })),
      [
        { name: "E2E Device A", revoked: false },
        { name: "E2E Device B", revoked: true },
      ],
      "A's device list after the revoke",
    );

    ctx.log("a phone signs in over the one wire and writes the library through it");
    const phone = await account.signIn({
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
    const [wrong] = await safe(asA.account.delete({ password: "not-the-password" }));
    expectEq(codeOf(wrong), "INVALID_CREDENTIALS", "a wrong password");
    await asA.account.devices.list();

    ctx.log("A deletes the account with its password");
    expectEq(
      await asA.account.delete({ password: OWNER.password }),
      { deleted: true },
      "A's deletion",
    );

    ctx.log("the account's cell, its files in R2 and its rows in D1 went with it");
    const gone = await holdingsOf(worker, accountId);
    expect(
      gone.cell.items === 0 && gone.cell.deleted !== null,
      `the deleted account's cell holds ${JSON.stringify(gone.cell)}`,
    );
    expectEq(gone.files, 0, "the deleted account's files in R2");
    expectEq(gone.rows, { devices: 0, sessions: 0, users: 0 }, "the deleted account's rows in D1");
    for (const [label, client] of [
      ["A", asA],
      ["the phone", v1Client(worker, phone.credential)],
    ] as const) {
      const [unreachable] = await safe(client.library.items.list({}));
      expectEq(codeOf(unreachable), "UNAUTHORIZED", `${label} after the deletion`);
    }

    ctx.log("the account is gone: its password signs nothing in, and its invite stays spent");
    const [login] = await safe(account.signIn({ ...OWNER, deviceName: "E2E Device A" }));
    expectEq(codeOf(login), "INVALID_CREDENTIALS", "signing in to the deleted account");
    const [recreated] = await safe(
      account.signUp({
        ...OWNER,
        deviceName: "E2E Device A",
        inviteCode: E2E_INVITE_CODE,
        name: "E2E Owner",
      }),
    );
    expectEq(codeOf(recreated), "FORBIDDEN", "reusing the deleted account's invite");
  },
};
