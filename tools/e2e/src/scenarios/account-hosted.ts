import { safe } from "@orpc/client";
import { expect, expectEq } from "../harness/assert";
import { OWNER, phoneSignIn, postSignUp, signInPhone, signUp } from "../harness/cloud-account";
import { E2E_INVITE_CODE, WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import type { Scenario } from "../harness/scenario";
import {
  accountIdOf,
  asExtension,
  asPhone,
  holdingsOf,
  newItemId,
  uploadFile,
  v1Client,
} from "../harness/v1-wire";
import { isOrpcError } from "@repo/contract/v1/errors";

// a one-pixel PNG, the file the phone keeps in the library
const PIXEL = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

// the code a refusal answers, or what was answered instead
const codeOf = (error: Error | null): string =>
  isOrpcError(error) ? error.code : `no refusal (${String(error)})`;

export const accountHosted: Scenario = {
  description:
    "an account created on the site with an invite code signs that browser in; the invite is spent, so a second sign-up with it is refused; a phone signs in with the same email and password, the browser lists both sessions and ends the phone's, whose next call is UNAUTHORIZED; a phone signed in again writes a note and a file into the account's library cell; a wrong password deletes nothing, and the right one takes the cell's items, the files in R2 and the account's rows in D1 with it, after which every session reaches nothing, the password signs nothing in and the invite stays spent",
  name: "account-hosted",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const worker = await ctx.cloudWorker();

    ctx.log("the site's sign-up creates the account with the invite code");
    const site = await signUp(worker.origin);
    // the browser's session, as its extension calls with it
    const browser = v1Client(worker, asExtension(site.cookie));

    ctx.log("the invite is spent: no other account can be created with it");
    const reused = await postSignUp(worker.origin, {
      email: "e2e-second@inteligir.local",
      inviteCode: E2E_INVITE_CODE,
      name: "E2E Second",
      password: OWNER.password,
    });
    await reused.arrayBuffer();
    expectEq(reused.status, 403, "reusing the invite");

    ctx.log("a phone signs in to the account with its email and password");
    const leaving = v1Client(worker, asPhone(await signInPhone(worker.origin)));
    await leaving.library.items.list({});

    ctx.log("the browser lists the account's sessions, and ends the phone's");
    const listed = await browser.account.devices.list();
    expectEq(
      listed.devices.map(({ current, name }) => (current ? "this browser" : name)),
      ["this browser", "iPhone"],
      "the browser's device list",
    );
    const phoneRow = listed.devices.find(({ current }) => !current);
    expect(phoneRow !== undefined, "the phone's session is listed");
    expectEq(
      await browser.account.devices.revoke({ id: phoneRow.id }),
      { revoked: true },
      "the browser's end of the phone's session",
    );
    const [revoked] = await safe(leaving.account.devices.list());
    expectEq(codeOf(revoked), "UNAUTHORIZED", "the phone's next call");
    const after = await browser.account.devices.list();
    expectEq(
      after.devices.map(({ current }) => current),
      [true],
      "the browser's device list after the end",
    );

    ctx.log("a phone signs in again and writes the library through the one wire");
    const phoneCaller = asPhone(await signInPhone(worker.origin));
    const phone = v1Client(worker, phoneCaller);
    const { item: note } = await phone.library.items.createNote({
      markdown: "Written over the one wire.",
      title: "From the phone",
    });
    const read = await phone.library.items.read({ id: note.id });
    expectEq(read.view.markdown, "Written over the one wire.\n", "the phone's note read back");
    const upload = await uploadFile(worker, phoneCaller, { bytes: PIXEL, type: "image/png" });
    expect(upload.status === 201, `the phone's upload answered ${String(upload.status)}`);
    const { item: file } = await phone.library.items.createFile({
      folderId: null,
      id: newItemId(),
      name: "pixel.png",
      savedAt: Date.now(),
      sha: upload.sha,
      tags: [],
    });
    const fileRead = await phone.library.items.read({ id: file.id });
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

    ctx.log("the phone's deletion with a wrong password is refused, and it stays signed in");
    const [wrong] = await safe(phone.account.delete({ password: "not-the-password" }));
    expectEq(codeOf(wrong), "INVALID_CREDENTIALS", "a wrong password");
    await phone.account.devices.list();

    ctx.log("the phone deletes the account with its password");
    expectEq(
      await phone.account.delete({ password: OWNER.password }),
      { deleted: true },
      "the phone's deletion",
    );

    ctx.log("the account's cell, its files in R2 and its rows in D1 went with it");
    const gone = await holdingsOf(worker, accountId);
    expect(
      gone.cell.items === 0 && gone.cell.deleted !== null,
      `the deleted account's cell holds ${JSON.stringify(gone.cell)}`,
    );
    expectEq(gone.files, 0, "the deleted account's files in R2");
    expectEq(gone.rows, { sessions: 0, users: 0 }, "the deleted account's rows in D1");
    for (const [label, client] of [
      ["the browser", browser],
      ["the phone", phone],
    ] as const) {
      const [unreachable] = await safe(client.library.items.list({}));
      expectEq(codeOf(unreachable), "UNAUTHORIZED", `${label} after the deletion`);
    }

    ctx.log("the account is gone: its password signs nothing in, and its invite stays spent");
    const signIn = await phoneSignIn(worker.origin, OWNER.password);
    await signIn.arrayBuffer();
    expectEq(signIn.status, 401, "signing in to the deleted account");
    const recreated = await postSignUp(worker.origin, {
      ...OWNER,
      inviteCode: E2E_INVITE_CODE,
      name: "E2E Owner",
    });
    await recreated.arrayBuffer();
    expectEq(recreated.status, 403, "reusing the deleted account's invite");
  },
};
