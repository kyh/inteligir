// A save the cloud did not answer, or made while its account was signed out, waits here, in
// `storage.local`, and is sent again by a pass over the queue. Each save is kept before its first
// call goes, so a worker stopped mid-save loses nothing, and it keeps the address and the title,
// never the page: what the queue sends is a link to read, which the cloud's fill reads once it
// lands (`items.saveLink`). One key a save, so two saves at once never write over each other. A
// save is sent only under the session of the account it was made under, so one made before a
// sign-out waits for that account to sign in again, whoever signs in meanwhile. Every try, the
// first and each resend, settles the save one way (`settle`). What wakes a pass is what the save
// waits for: an alarm for a call the cloud did not answer, since the worker dies 30 s after its
// last event and a timer with it, and the browser's own events for a sign-in or an update
// (../entrypoints/background).

import { outcomeOf } from "@repo/contract/library/call-outcome";
import type { CallOutcome } from "@repo/contract/library/call-outcome";
import { browser } from "wxt/browser";
import { z } from "zod";

import type { Cloud, LinkSave } from "./cloud";
import { forgetConnection, readConnection } from "./connection";
import type { Session, SignIn } from "./sign-in";

const KEY_PREFIX = "save:";
export const SEND_ALARM = "send-saves";
// how often a waiting save is tried again
const RETRY_MINUTES = 0.5;

const queuedSaveSchema = z.strictObject({
  // the account it was made under, whose library alone it lands in
  email: z.string().min(1),
  // the item's id and the write's op id, minted once, so a resend after a lost answer lands once
  id: z.uuidv7(),
  opId: z.uuid(),
  savedAt: z.number().int().nonnegative(),
  title: z.string(),
  url: z.string().min(1),
});
export type QueuedSave = z.infer<typeof queuedSaveSchema>;

const keyOf = (save: Pick<QueuedSave, "opId">): string => `${KEY_PREFIX}${save.opId}`;

const dropSave = async (save: Pick<QueuedSave, "opId">): Promise<void> => {
  await browser.storage.local.remove(keyOf(save));
};

// every save waiting, oldest first; a record that does not parse is dropped, never sent
export const queuedSaves = async (): Promise<QueuedSave[]> => {
  const stored = await browser.storage.local.get(null);
  const saves: QueuedSave[] = [];
  for (const [key, value] of Object.entries(stored)) {
    if (!key.startsWith(KEY_PREFIX)) {
      continue;
    }
    const parsed = queuedSaveSchema.safeParse(value);
    if (parsed.success) {
      saves.push(parsed.data);
    } else {
      await browser.storage.local.remove(key);
    }
  }
  return saves.toSorted((a, b) => a.savedAt - b.savedAt);
};

export const keepSave = async (save: QueuedSave): Promise<void> => {
  await browser.storage.local.set({ [keyOf(save)]: save });
};

// the cloud deleted the account `email` named: what waited for it can never land, and this browser
// no longer holds it, unless a sign-in as another account replaced it while the call was on its way
export const accountGone = async (email: string): Promise<void> => {
  const saves = await queuedSaves();
  await browser.storage.local.remove(saves.filter((save) => save.email === email).map(keyOf));
  const held = await readConnection();
  if (held?.email === email) {
    await forgetConnection();
  }
};

// a waiting save as the link it is sent as: its title only where it has one
export const linkOf = (save: QueuedSave): LinkSave => {
  const link: LinkSave = { id: save.id, opId: save.opId, savedAt: save.savedAt, url: save.url };
  if (save.title !== "") {
    link.title = save.title;
  }
  return link;
};

// What the worker holds of the queue and loses nothing by stopping with. The saves whose first try
// it still runs, which a pass leaves to them: a resend meanwhile could land the link under the
// save's op id while the page was on its way, and a save whose worker stopped mid-try is sent at
// the next pass like any that waits. And the tries the cloud did not answer, counted so a pass's
// end knows of one that ended while it ran.
const trying = new Set<string>();
let unanswered = 0;

// a kept save's try, the first or a resend, and the one place its answer moves the save: one that
// waits stays as it was kept
const settle = async <T>(
  save: QueuedSave,
  send: () => Promise<CallOutcome<T>>,
): Promise<CallOutcome<T>> => {
  const outcome = await send();
  switch (outcome.kind) {
    case "landed":
    case "refused": {
      await dropSave(save);
      break;
    }
    case "gone": {
      await accountGone(save.email);
      break;
    }
    case "wait": {
      if (outcome.for === "connection") {
        unanswered += 1;
      }
      break;
    }
    // no default
  }
  return outcome;
};

const holdAlarm = async (): Promise<void> => {
  await browser.alarms.create(SEND_ALARM, { periodInMinutes: RETRY_MINUTES });
};

// a save's first try: kept before its call goes, the alarm with it, since a worker stopped mid-try
// says nothing more of the save, then settled by the call's answer as every resend is
export const sendKept = async <T>(
  save: QueuedSave,
  send: () => Promise<CallOutcome<T>>,
): Promise<CallOutcome<T>> => {
  trying.add(save.opId);
  try {
    await keepSave(save);
    await holdAlarm();
    return await settle(save, send);
  } finally {
    trying.delete(save.opId);
  }
};

export interface SendDeps {
  readonly cloud: (session: Session) => Cloud;
  // the cloud asked who this browser is signed in as, null when it did not answer
  readonly signIn: () => Promise<SignIn | null>;
}

// an account's saves sent oldest first, until one cannot go yet: the cloud is not there, not for
// this build, or not for this session, so the rest wait with it
const sendAs = async (cloud: Cloud, email: string, saves: readonly QueuedSave[]): Promise<void> => {
  for (const save of saves) {
    if (save.email !== email) {
      continue;
    }
    const outcome = await settle(
      save,
      async () => await outcomeOf(async () => await cloud.saveLink(linkOf(save))),
    );
    if (outcome.kind === "wait" || outcome.kind === "gone") {
      break;
    }
  }
};

// every save of the account signed in is sent: another account's waits for that account, and a
// first try still under way for its own answer. The pass's end is where the alarm stands or goes.
// It stands for what a timer changes, a call the cloud did not answer or a first try whose worker
// may stop, and goes while every save waits on a person, whom an event tells of
const sendPass = async (deps: SendDeps): Promise<void> => {
  const before = unanswered;
  const kept = await queuedSaves();
  const saves = kept.filter((save) => !trying.has(save.opId));
  if (saves.length > 0) {
    const signIn = await deps.signIn();
    if (signIn === null) {
      unanswered += 1;
    } else if (signIn.kind === "signed-in") {
      await sendAs(deps.cloud(signIn.session), signIn.session.email, saves);
    }
  }
  await (unanswered > before || trying.size > 0 ? holdAlarm() : browser.alarms.clear(SEND_ALARM));
};

// One pass over the queue at a time: a save landed, the alarm, a sign-in and the worker's start
// each ask for one, and an ask while a pass runs asks for one more after it, so what changed
// mid-pass is read again and no two passes send one save. The pass lives as long as the worker,
// which loses nothing it needs later with it.
type Pass = { readonly kind: "idle" } | { readonly kind: "running"; readonly again: boolean };

const passAfter = (pass: Pass, event: "asked" | "finished" | "failed"): Pass => {
  switch (event) {
    case "asked": {
      return { again: pass.kind === "running", kind: "running" };
    }
    case "finished": {
      return pass.kind === "running" && pass.again
        ? { again: false, kind: "running" }
        : { kind: "idle" };
    }
    // a storage fault: the next ask starts over
    case "failed": {
      return { kind: "idle" };
    }
    // no default
  }
};

let pass: Pass = { kind: "idle" };
let drained: Promise<void> = Promise.resolve();

const drain = async (deps: SendDeps): Promise<void> => {
  do {
    try {
      await sendPass(deps);
    } catch (error) {
      pass = passAfter(pass, "failed");
      throw error;
    }
    pass = passAfter(pass, "finished");
  } while (pass.kind === "running");
};

// settles once a pass that started after the ask has run
export const sendQueued = async (deps: SendDeps): Promise<void> => {
  const starts = pass.kind === "idle";
  pass = passAfter(pass, "asked");
  if (starts) {
    drained = drain(deps);
  }
  await drained;
};
