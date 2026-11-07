// A save the cloud did not answer waits here, in `storage.local`, and is sent again by an alarm.
// Each save is kept before its first call goes, so a worker stopped mid-save loses nothing, and
// it keeps the address, the title and the passage the person had selected, never the page: what
// the queue sends is a link to read, which the cloud's fill reads once it lands and places the
// passage in (`items.saveLink`). One key a save, so two saves at once never write over each
// other; an alarm, since the worker dies 30 s after its last event and a timer with it, made as a
// save is kept and again at every start, since an update or a restart can clear one.

import { browser } from "wxt/browser";
import { z } from "zod";

import { COVER_DEADLINE_MS, COVER_TRIES } from "./capture-tab";
import { CALL_DEADLINE_MS, failureOf } from "./cloud";
import type { CallFailure, Cloud, LinkSave } from "./cloud";
import { forgetConnection, readConnection } from "./connection";
import type { Connection } from "./connection";

const KEY_PREFIX = "save:";
export const SEND_ALARM = "send-saves";
// how often a waiting save is tried again
const RETRY_MINUTES = 0.5;
// the longest a first try's page takes to land (./save-page): every cover candidate it fetches,
// each to its deadline, then the cover's put and the save, each to theirs
const FIRST_TRY_MS = COVER_TRIES * COVER_DEADLINE_MS + 2 * CALL_DEADLINE_MS;
// a save whose first try never said how it went is sent again once that try is past its longest,
// since its worker was stopped mid-call; a resend sooner could land the link under the save's op id
// while the first try's page was still on its way, and the cell would answer that with the link.
// The margin is the page's reading, which runs before the first call
const ABANDONED_MS = FIRST_TRY_MS + 30_000;

const queuedSaveSchema = z.strictObject({
  // the device it was made under: a save is never sent under another connection's credential
  deviceId: z.string().min(1),
  // no try has gone unanswered yet, so the first may still be under way
  firstTry: z.boolean(),
  // the item's id and the write's op id, minted once, so a resend after a lost answer lands once
  id: z.uuidv7(),
  opId: z.uuid(),
  savedAt: z.number().int().nonnegative(),
  selection: z.string().min(1).nullable(),
  title: z.string(),
  url: z.string().min(1),
});
export type QueuedSave = z.infer<typeof queuedSaveSchema>;

const keyOf = (save: Pick<QueuedSave, "opId">): string => `${KEY_PREFIX}${save.opId}`;

export const dropSave = async (save: Pick<QueuedSave, "opId">): Promise<void> => {
  await browser.storage.local.remove(keyOf(save));
};

// every save waiting, oldest first; a record that does not parse is dropped, never sent
/** @internal */
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

const forgetQueue = async (): Promise<void> => {
  const saves = await queuedSaves();
  await browser.storage.local.remove(saves.map(keyOf));
};

// the alarm stands while a save waits, and goes once none does
export const ensureSendAlarm = async (): Promise<void> => {
  const saves = await queuedSaves();
  const waiting = saves.length > 0;
  const alarm = await browser.alarms.get(SEND_ALARM);
  if (waiting && alarm === undefined) {
    await browser.alarms.create(SEND_ALARM, { periodInMinutes: RETRY_MINUTES });
  }
  if (!waiting && alarm !== undefined) {
    await browser.alarms.clear(SEND_ALARM);
  }
};

// the alarm is made with the record, since a worker stopped mid-try says nothing more of it
export const keepSave = async (save: QueuedSave): Promise<void> => {
  await browser.storage.local.set({ [keyOf(save)]: save });
  await ensureSendAlarm();
};

// the cloud no longer takes `deviceId`'s credential: the extension forgets it and what waited under
// it, and answers true. A call still on its way when a connect replaced that credential answers for
// the one it replaced, so the connection held now stays, and what the old one left waiting goes at
// the next send, which sends nothing under another device's credential
export const signedOut = async (deviceId: string): Promise<boolean> => {
  const held = await readConnection();
  if (held?.deviceId !== deviceId) {
    return false;
  }
  await forgetConnection();
  await forgetQueue();
  await ensureSendAlarm();
  return true;
};

// a try that went unanswered: the save waits for the alarm
export const markWaiting = async (save: QueuedSave): Promise<void> => {
  await keepSave({ ...save, firstTry: false });
};

// a waiting save as the link it is sent as: its passage and its title only where it has one
export const linkOf = (save: QueuedSave): LinkSave => {
  const link: LinkSave = { id: save.id, opId: save.opId, savedAt: save.savedAt, url: save.url };
  if (save.selection !== null) {
    link.selection = save.selection;
  }
  if (save.title !== "") {
    link.title = save.title;
  }
  return link;
};

export interface SendDeps {
  readonly connection: () => Promise<Connection | null>;
  readonly cloud: (connection: Connection) => Cloud;
  readonly now: () => number;
}

// a call a later try may pass with nothing asked of the person: no answer, or a build too old for
// the cloud, which the browser updates by itself while `storage.local` keeps what waits
const waitsToResend = (failure: CallFailure): boolean =>
  failure.kind === "unanswered" ||
  (failure.kind === "refused" && failure.reason === "update-extension");

// every waiting save sent oldest first, until one cannot go yet: the cloud is not there, or not for
// this build, so the rest wait with it
export const sendQueued = async (deps: SendDeps): Promise<void> => {
  const connection = await deps.connection();
  for (const save of await queuedSaves()) {
    if (connection === null || save.deviceId !== connection.deviceId) {
      await dropSave(save);
      continue;
    }
    const due = !save.firstTry || deps.now() - save.savedAt >= ABANDONED_MS;
    if (!due) {
      continue;
    }
    try {
      await deps.cloud(connection).saveLink(linkOf(save));
      await dropSave(save);
    } catch (error) {
      const failure = failureOf(error);
      if (waitsToResend(failure)) {
        await markWaiting(save);
        break;
      }
      if (failure.kind === "signed-out") {
        await signedOut(save.deviceId);
        break;
      }
      await dropSave(save);
    }
  }
  await ensureSendAlarm();
};
