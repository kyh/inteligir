import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AppRuntime } from "@repo/mobile/lib/compose-runtime";
import { expect, expectEq } from "../harness/assert";
import { loginDevice, OWNER, signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { exec, hermeticProcessEnv } from "../harness/exec";
import { hostedVaultEnv, syncUntil, untilIdentityKnown } from "../harness/hosted-vault";
import { PHONE_NAME, phoneRuntime, readPhoneNote, untilMirrored } from "../harness/phone-runtime";
import type { Scenario } from "../harness/scenario";

const PLAN = "notes/plan.md";

// three paragraphs, so a comment on each is a change to its own line and the three merge
const NOTE = "# Plan\n\nline one\n\nline two\n\nline three\n";

// what the phone's editor page hands the phone: the note's text with the comment's markers around
// the words it was made on
const anchored = (text: string, words: string, id: string): string => {
  expect(text.includes(words), `the note holds "${words}"`);
  return text.replace(words, `%%i:${id}:start%%${words}%%i:${id}:end%%`);
};

const commentOnPhone = async (
  phone: AppRuntime,
  words: string,
  id: string,
  text: string,
): Promise<void> => {
  const held = await readPhoneNote(phone, PLAN);
  const added = await phone.comments.add({
    anchor: { content: anchored(held, words, id), expected: held },
    id,
    path: PLAN,
    text,
  });
  expect(added.kind === "edited", `the phone's comment ${id}: ${JSON.stringify(added)}`);
};

const drained = async (phone: AppRuntime, label: string): Promise<void> => {
  await phone.notes.drain();
  const { parked, unsent } = phone.notes.outbox.status.get();
  expectEq(unsent, 0, `${label}: the phone's unsent changes`);
  expectEq(parked.length, 0, `${label}: the phone's parked changes`);
};

export const phoneCommentsHosted: Scenario = {
  description:
    "the phone's own runtime comments on a note with no id, then replies and comments again offline while A comments on the same note; A syncs every thread anchored on its own words, and the phone's resolve",
  name: "phone-comments-hosted",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const worker = await ctx.cloudWorker();

    ctx.log("creating the account; A signs in and pushes a note with no id");
    await signUp(worker.origin);
    const a = await ctx.boot({ extraEnv: hostedVaultEnv(worker.origin), name: "a" });
    const signedIn = await a.api.cloud.login({ ...OWNER, deviceName: "E2E Device A" });
    expect(signedIn.state === "signed-in", `A's login answered ${signedIn.state}`);
    await untilIdentityKnown(a.api, "A");
    await a.api.vault.write({ content: NOTE, guard: { kind: "overwrite" }, path: PLAN });
    await syncUntil(a.api, "A after its note", "clean");

    ctx.log("the phone mirrors the note and comments on it, minting its id");
    const network = { online: true };
    const phone = await phoneRuntime(
      worker.origin,
      path.join(ctx.scratchDir, "phone"),
      await loginDevice(worker.origin, PHONE_NAME),
      network,
    );
    await phone.start();
    await untilMirrored(phone, [PLAN]);
    await commentOnPhone(phone, "line one", "phone1", "From the phone");
    await drained(phone, "after the first comment");

    ctx.log("A syncs the note, its new id and the comment anchored on the phone's words");
    await syncUntil(a.api, "A pulling the phone's comment", "clean");
    const pulled = await readFile(path.join(a.vaultDir, PLAN), "utf-8");
    expect(/^---\nid: \S+\n---\n/u.test(pulled), `A's note carries the phone's id: ${pulled}`);
    expect(
      pulled.includes("%%i:phone1:start%%line one%%i:phone1:end%%"),
      `A's note carries the phone's markers: ${pulled}`,
    );
    const first = await a.api.comments.list({ path: PLAN });
    expect(
      first.threads.length === 1 &&
        first.threads[0]?.rootId === "phone1" &&
        first.threads[0].anchored &&
        first.threads[0].root.text === "From the phone" &&
        first.threads[0].root.source === "user",
      `A's threads after the first pull: ${JSON.stringify(first.threads)}`,
    );

    ctx.log("offline, the phone replies and comments again while A comments on the same note");
    network.online = false;
    const replied = await phone.comments.reply(PLAN, "phone1", "A reply from the phone");
    expect(replied.kind === "done", `the phone's reply: ${JSON.stringify(replied)}`);
    await commentOnPhone(phone, "line two", "phone2", "Also from the phone");
    await a.api.vault.write({
      content: anchored(pulled, "line three", "mac1"),
      guard: { kind: "overwrite" },
      path: PLAN,
    });
    await a.api.comments.add({ id: "mac1", path: PLAN, text: "From the Mac" });
    await syncUntil(a.api, "A after its own comment", "clean");

    ctx.log("the phone reconnects, and A syncs all three threads, each on its own words");
    network.online = true;
    await drained(phone, "after reconnecting");
    await syncUntil(a.api, "A pulling the phone's offline comments", "clean");
    const merged = await readFile(path.join(a.vaultDir, PLAN), "utf-8");
    for (const [id, words] of [
      ["phone1", "line one"],
      ["phone2", "line two"],
      ["mac1", "line three"],
    ] as const) {
      expect(
        merged.includes(`%%i:${id}:start%%${words}%%i:${id}:end%%`),
        `A's note anchors ${id} on "${words}": ${merged}`,
      );
    }
    const all = await a.api.comments.list({ path: PLAN });
    const byRoot = new Map(all.threads.map((thread) => [thread.rootId, thread]));
    expectEq([...byRoot.keys()].toSorted(), ["mac1", "phone1", "phone2"], "A's threads");
    expect(
      [...byRoot.values()].every((thread) => thread.anchored),
      `every thread is anchored on A: ${JSON.stringify(all.threads)}`,
    );
    expectEq(
      byRoot.get("phone1")?.replies.map((reply) => reply.entry.text) ?? [],
      ["A reply from the phone"],
      "the phone's reply on A",
    );

    ctx.log("the phone resolves its first thread, and A syncs it resolved");
    const resolved = await phone.comments.resolve(PLAN, "phone1", true);
    expect(resolved.kind === "done", `the phone's resolve: ${JSON.stringify(resolved)}`);
    await drained(phone, "after the resolve");
    await syncUntil(a.api, "A pulling the phone's resolve", "clean");
    const settled = await a.api.comments.list({ path: PLAN });
    expect(
      settled.threads.find((thread) => thread.rootId === "phone1")?.resolved === true &&
        settled.threads.filter((thread) => thread.resolved).length === 1,
      `A's threads after the resolve: ${JSON.stringify(settled.threads)}`,
    );
    await exec("git", ["-C", a.vaultDir, "fsck", "--strict"], { env: hermeticProcessEnv() });
  },
};
