import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AppRuntime } from "@repo/mobile/lib/compose-runtime";
import { expect, expectEq } from "../harness/assert";
import { signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { gitIn } from "../harness/exec";
import { hostedVaultEnv, signInOwner, syncUntil } from "../harness/hosted-vault";
import { drained, phoneRuntime, readPhoneNote, untilMirrored } from "../harness/phone-runtime";
import type { Scenario } from "../harness/scenario";

const PLAN = "notes/plan.md";

// three paragraphs, so an annotation on each is a change to its own line and the three merge
const NOTE = "# Plan\n\nline one\n\nline two\n\nline three\n";

// what the phone's editor page hands the phone: the note's text with the annotation's markers
// around the words it was made on
const anchored = (text: string, words: string, id: string): string => {
  expect(text.includes(words), `the note holds "${words}"`);
  return text.replace(words, `%%i:${id}:start%%${words}%%i:${id}:end%%`);
};

// the page's Save: the highlight with its markers, then its note as a store write of its own
const annotateOnPhone = async (
  phone: AppRuntime,
  words: string,
  id: string,
  note: string,
): Promise<void> => {
  const held = await readPhoneNote(phone, PLAN);
  const added = await phone.annotations.add({
    anchor: { content: anchored(held, words, id), expected: held },
    id,
    path: PLAN,
    quote: words,
  });
  expect(added.kind === "edited", `the phone's annotation ${id}: ${JSON.stringify(added)}`);
  const noted = await phone.annotations.edit(PLAN, id, note);
  expect(noted.kind === "done", `the phone's note on ${id}: ${JSON.stringify(noted)}`);
};

export const phoneAnnotationsHosted: Scenario = {
  description:
    "the phone's own runtime annotates a note with no id, minting it one; offline it replies and annotates again while A annotates the same note; after A syncs, every annotation is anchored on its own words with its quote, the reply is there, and the phone's later note reaches A",
  name: "phone-annotations-hosted",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const worker = await ctx.cloudWorker();

    ctx.log("creating the account; A signs in and pushes a note with no id");
    await signUp(worker.origin);
    const a = await ctx.boot({ extraEnv: hostedVaultEnv(worker.origin), name: "a" });
    await signInOwner(a, "A", "E2E Device A");
    await a.api.vault.write({ content: NOTE, guard: { kind: "overwrite" }, path: PLAN });
    await syncUntil(a.api, "A after its note", "clean");

    ctx.log("the phone mirrors the note and annotates it, minting its id");
    const network = { online: true };
    const phone = await phoneRuntime(worker.origin, path.join(ctx.scratchDir, "phone"), network);
    await phone.start();
    await untilMirrored(phone, [PLAN]);
    await annotateOnPhone(phone, "line one", "phone1", "From the phone");
    await drained(phone, "after the first annotation");

    ctx.log("A syncs the note, its new id and the annotation anchored on the phone's words");
    await syncUntil(a.api, "A pulling the phone's annotation", "clean");
    const pulled = await readFile(path.join(a.vaultDir, PLAN), "utf-8");
    expect(/^---\nid: \S+\n---\n/u.test(pulled), `A's note carries the phone's id: ${pulled}`);
    expect(
      pulled.includes("%%i:phone1:start%%line one%%i:phone1:end%%"),
      `A's note carries the phone's markers: ${pulled}`,
    );
    const first = await a.api.annotations.list({ path: PLAN });
    expect(
      first.annotations.length === 1 &&
        first.annotations[0]?.id === "phone1" &&
        first.annotations[0].state === "anchored" &&
        first.annotations[0].root.quote === "line one" &&
        first.annotations[0].root.text === "From the phone" &&
        first.annotations[0].root.source === "user",
      `A's annotations after the first pull: ${JSON.stringify(first.annotations)}`,
    );

    ctx.log("offline, the phone replies and annotates again while A annotates the same note");
    network.online = false;
    const replied = await phone.annotations.reply(PLAN, "phone1", "A reply from the phone");
    expect(replied.kind === "done", `the phone's reply: ${JSON.stringify(replied)}`);
    await annotateOnPhone(phone, "line two", "phone2", "Also from the phone");
    await a.api.vault.write({
      content: anchored(pulled, "line three", "mac1"),
      guard: { kind: "overwrite" },
      path: PLAN,
    });
    await a.api.annotations.add({
      id: "mac1",
      path: PLAN,
      quote: "line three",
      text: "From the Mac",
    });
    await syncUntil(a.api, "A after its own annotation", "clean");

    ctx.log("the phone reconnects, and A syncs all three annotations, each on its own words");
    network.online = true;
    await drained(phone, "after reconnecting");
    await syncUntil(a.api, "A pulling the phone's offline annotations", "clean");
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
    const all = await a.api.annotations.list({ path: PLAN });
    const byRoot = new Map(all.annotations.map((annotation) => [annotation.id, annotation]));
    expectEq([...byRoot.keys()].toSorted(), ["mac1", "phone1", "phone2"], "A's annotations");
    expect(
      [...byRoot.values()].every((annotation) => annotation.state === "anchored"),
      `every annotation is anchored on A: ${JSON.stringify(all.annotations)}`,
    );
    expectEq(
      all.annotations.map((annotation) => annotation.id),
      ["phone1", "phone2", "mac1"],
      "A lists the annotations in the order their passages read",
    );
    expectEq(
      byRoot.get("phone1")?.replies.map((reply) => reply.entry.text) ?? [],
      ["A reply from the phone"],
      "the phone's reply on A",
    );

    ctx.log("the phone rewrites its first annotation's note, and A syncs the new note");
    const edited = await phone.annotations.edit(PLAN, "phone1", "Rewritten on the phone");
    expect(edited.kind === "done", `the phone's edit: ${JSON.stringify(edited)}`);
    await drained(phone, "after the edit");
    await syncUntil(a.api, "A pulling the phone's edit", "clean");
    const settled = await a.api.annotations.list({ path: PLAN });
    expect(
      settled.annotations.find((annotation) => annotation.id === "phone1")?.root.text ===
        "Rewritten on the phone",
      `A's annotations after the edit: ${JSON.stringify(settled.annotations)}`,
    );
    await gitIn(a.vaultDir, ["fsck", "--strict"]);
  },
};
