// A save the cloud did not answer waits here, in `storage.local`, and is sent again by an alarm.
// Each save is kept before its first call goes, so a worker stopped mid-save loses nothing, and
// it keeps the address, the title and the passage the person had selected, never the page: what
// the queue sends is a link to read, which the cloud's fill reads once it lands and places the
// passage in (`items.saveLink`). One key a save, so two saves at once never write over each
// other; an alarm, since the worker dies 30 s after its last event and a timer with it, made again
// at every start, since an update or a restart can clear one.

import { browser } from "wxt/browser";
import { z } from "zod";

import { failureOf } from "./cloud";
import type { Cloud, LinkSave } from "./cloud";
import type { Connection } from "./connection";

const KEY_PREFIX = "save:";
export const SEND_ALARM = "send-saves";
// how often a waiting save is tried again
const RETRY_MINUTES = 0.5;
// a save whose first try never said how it went, its worker stopped mid-call, is sent again
// after this, by which time that try has met its deadline
const ABANDONED_MS = 60_000;

const queuedSaveSchema = z.strictObject({
  // the device it was made under: a save is never sent under another connection's credential
  deviceId: z.string().min(1),
  // the item's id and the write's op id, minted once, so a resend after a lost answer lands once
  id: z.uuidv7(),
  opId: z.uuid(),
  savedAt: z.number().int().nonnegative(),
  selection: z.string().min(1).nullable(),
  title: z.string(),
  url: z.string().min(1),
  // when a try last went unanswered; null while the first is under way
  waitingSince: z.number().int().nonnegative().nullable(),
});
export type QueuedSave = z.infer<typeof queuedSaveSchema>;

const keyOf = (save: Pick<QueuedSave, "opId">): string => `${KEY_PREFIX}${save.opId}`;

export const keepSave = async (save: QueuedSave): Promise<void> => {
  await browser.storage.local.set({ [keyOf(save)]: save });
};

export const dropSave = async (save: Pick<QueuedSave, "opId">): Promise<void> => {
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

export const forgetQueue = async (): Promise<void> => {
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

// a try that went unanswered: the save waits for the alarm
export const markWaiting = async (save: QueuedSave, now: number): Promise<void> => {
  await keepSave({ ...save, waitingSince: now });
  await ensureSendAlarm();
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
  // the connection's credential is no longer the account's: forget it and every save made under it
  readonly signedOut: () => Promise<void>;
  readonly now: () => number;
}

// every waiting save sent oldest first, until one goes unanswered: the cloud is not there yet, so
// the rest wait with it
export const sendQueued = async (deps: SendDeps): Promise<void> => {
  const connection = await deps.connection();
  for (const save of await queuedSaves()) {
    if (connection === null || save.deviceId !== connection.deviceId) {
      await dropSave(save);
      continue;
    }
    const due = save.waitingSince !== null || deps.now() - save.savedAt >= ABANDONED_MS;
    if (!due) {
      continue;
    }
    try {
      await deps.cloud(connection).saveLink(linkOf(save));
      await dropSave(save);
    } catch (error) {
      const failure = failureOf(error);
      if (failure.kind === "unanswered") {
        await markWaiting(save, deps.now());
        break;
      }
      if (failure.kind === "signed-out") {
        await deps.signedOut();
        break;
      }
      await dropSave(save);
    }
  }
  await ensureSendAlarm();
};
