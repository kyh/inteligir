// The extension's waiting saves (`@repo/client/waiting-saves`), in `storage.local`: a save is kept
// before its first call goes, so a worker stopped mid-save loses nothing, and it keeps the address
// and the title, never the page, since what a pass sends is a link to read, which the cloud's fill
// reads once it lands (`items.saveLink`). What is the extension's own is here. A save is sent only
// under the session of the account it was made under, so one made before a sign-out waits for that
// account to sign in again, whoever signs in meanwhile. A save's first try runs outside a pass,
// since it carries the page as read. And what wakes a pass is what the save waits for: an alarm
// for a call the cloud did not answer, since the worker dies 30 s after its last event and a timer
// with it, and the browser's own events for a sign-in or an update (../entrypoints/background).

import { oneAtATime, waitingSaves } from "@repo/client/waiting-saves";
import type { KvStorage, WaitingSave } from "@repo/client/waiting-saves";
import { outcomeOf } from "@repo/contract/rpc/call-outcome";
import type { CallOutcome } from "@repo/contract/rpc/call-outcome";
import { browser } from "wxt/browser";
import { z } from "zod";

import type { HeldSaves } from "../messages";
import type { Cloud, LinkSave } from "./cloud";
import { forgetConnection, readConnection } from "./connection";
import type { Session, SignIn } from "./sign-in";

export const SEND_ALARM = "send-saves";
// how often a waiting save is tried again
const RETRY_MINUTES = 0.5;

const keptSchema = z.strictObject({
  // the account it was made under, whose library alone it lands in
  email: z.string().min(1),
  title: z.string(),
  url: z.string().min(1),
});
export type QueuedSave = WaitingSave<z.infer<typeof keptSchema>>;

// `storage.local` as the queue reads a store: one key a save, so two saves at once never write
// over each other
const storage: KvStorage = {
  getAllKeys: async () => Object.keys(await browser.storage.local.get(null)),
  getItem: async (key) => {
    const held = await browser.storage.local.get(key);
    const text = z.string().safeParse(held[key]);
    return text.success ? text.data : null;
  },
  removeItem: async (key) => {
    await browser.storage.local.remove(key);
  },
  setItem: async (key, value) => {
    await browser.storage.local.set({ [key]: value });
  },
};

// a page saved twice for one account lands as one item, its title the latest
const saves = waitingSaves({
  payload: keptSchema,
  prefix: "save:",
  sameSave: (a, b) => a.email === b.email && a.url === b.url,
  storage,
});

// every save kept, oldest first, the refused among them
export const queuedSaves = saves.list;

// a save kept with no try, which waits for its account to sign in
export const keepSave = async (save: QueuedSave): Promise<void> => {
  await saves.keep(save, save.payload);
};

// the cloud deleted the account `email` named: what waited for it can never land, and this browser
// no longer holds it, unless a sign-in as another account replaced it while the call was on its way
export const accountGone = async (email: string): Promise<void> => {
  await saves.clear((save) => save.payload.email === email);
  const held = await readConnection();
  if (held?.email === email) {
    await forgetConnection();
  }
};

// a waiting save as the link it is sent as; an empty title is a link with no name yet
export const linkOf = (save: QueuedSave): LinkSave => {
  const { title, url } = save.payload;
  return { id: save.id, opId: save.opId, savedAt: save.savedAt, title, url };
};

// What the worker holds of the queue and loses nothing by stopping with. The saves whose first try
// it still runs, which a pass leaves to them: a resend meanwhile could land the link under the
// save's op id while the page was on its way, and a save whose worker stopped mid-try is sent at
// the next pass like any that waits. And the tries the cloud did not answer, counted so a pass's
// end knows of one that ended while it ran.
const trying = new Set<string>();
let unanswered = 0;

// what a try's outcome means past the save that made it, whichever try met it: a deleted account
// takes everything kept for it, and a call the cloud left unanswered is counted for the alarm
const met = async <T>(save: QueuedSave, outcome: CallOutcome<T>): Promise<CallOutcome<T>> => {
  if (outcome.kind === "gone") {
    await accountGone(save.payload.email);
  } else if (outcome.kind === "wait" && outcome.for === "connection") {
    unanswered += 1;
  }
  return outcome;
};

const holdAlarm = async (): Promise<void> => {
  await browser.alarms.create(SEND_ALARM, { periodInMinutes: RETRY_MINUTES });
};

// a save's first try: kept before its call goes, the alarm with it, since a worker stopped mid-try
// says nothing more of the save, then settled by the call's outcome as every resend is
export const sendKept = async <T>(
  save: QueuedSave,
  send: () => Promise<CallOutcome<T>>,
): Promise<CallOutcome<T>> => {
  trying.add(save.opId);
  try {
    await keepSave(save);
    await holdAlarm();
    const outcome = await met(save, await send());
    await saves.settle(save.opId, outcome);
    return outcome;
  } finally {
    trying.delete(save.opId);
  }
};

export interface SendDeps {
  readonly cloud: (session: Session) => Cloud;
  // the cloud asked who this browser is signed in as, null when it did not answer
  readonly signIn: () => Promise<SignIn | null>;
}

// who a pass sends as, or what its saves wait for: the cloud to say who is signed in, or a sign-in
type Sender =
  | { readonly kind: "account"; readonly email: string; readonly cloud: Cloud }
  | { readonly kind: "wait"; readonly for: "connection" | "sign-in" };

const senderOf = async (deps: SendDeps): Promise<Sender> => {
  const signIn = await deps.signIn();
  if (signIn === null) {
    return { for: "connection", kind: "wait" };
  }
  return signIn.kind === "signed-in"
    ? { cloud: deps.cloud(signIn.session), email: signIn.session.email, kind: "account" }
    : { for: "sign-in", kind: "wait" };
};

const SKIPPED = { kind: "skipped" } as const;

// every save of the account signed in is sent as its link: another account's waits for that
// account, and a first try still under way for its own answer. The pass's end is where the alarm
// stands or goes. It stands for what a timer changes, a call the cloud did not answer or a first
// try whose worker may stop, and goes while every save waits on a person, whom an event tells of
const sendPass = async (deps: SendDeps): Promise<void> => {
  const before = unanswered;
  // asked once a pass, and only once a save is there to send
  let asked: Promise<Sender> | undefined;
  await saves.pass(async (save) => {
    if (trying.has(save.opId)) {
      return SKIPPED;
    }
    asked ??= senderOf(deps);
    const sender = await asked;
    if (sender.kind === "wait") {
      return await met(save, sender);
    }
    if (save.payload.email !== sender.email) {
      return SKIPPED;
    }
    return await met(save, await outcomeOf(async () => await sender.cloud.saveLink(linkOf(save))));
  });
  await (unanswered > before || trying.size > 0 ? holdAlarm() : browser.alarms.clear(SEND_ALARM));
};

// a save landed, the alarm, a sign-in, the worker's start and the popup's Try again each ask for a
// pass, and no two run at once
export const sendQueued = oneAtATime(sendPass);

// `email`'s saves as the popup shows them: those its library refused, by title where one was read,
// and how many wait to be sent
export const heldSaves = async (email: string): Promise<HeldSaves> => {
  const all = await saves.list();
  const kept = all.filter(({ payload }) => payload.email === email);
  return {
    refused: kept.flatMap(({ opId, payload, refused }) =>
      refused === null
        ? []
        : [{ message: refused, name: payload.title === "" ? payload.url : payload.title, opId }],
    ),
    waiting: kept.filter(({ refused }) => refused === null).length,
  };
};

// a refused save waits to be sent again, which the next pass does
export const retrySave = saves.retry;

export const discardSave = saves.discard;
