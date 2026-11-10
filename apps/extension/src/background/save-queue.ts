// A save the cloud did not answer, or made while its account was signed out, waits here, in
// `storage.local`, and is sent again by an alarm. Each save is kept before its first call goes, so
// a worker stopped mid-save loses nothing, and it keeps the address and the title, never the page:
// what the queue sends is a link to read, which the cloud's fill reads once it lands
// (`items.saveLink`). One key a save, so two saves at once never write over each other; an alarm,
// since the worker dies 30 s after its last event and a timer with it, made as a save is kept and
// again at every start, since an update or a restart can clear one. A save is sent only under the
// session of the account it was made under, so one made before a sign-out waits for that account
// to sign in again, whoever signs in meanwhile. Every try, the first and each resend, settles the
// save one way (`settle`).

import type { SessionEnd } from "@repo/contract/library/call-outcome";
import { PayloadTooLargeError, QuotaError } from "@repo/contract/v1/errors";
import { browser } from "wxt/browser";
import { z } from "zod";

import type { OutcomeReason, WaitsFor } from "../messages";
import { COVER_DEADLINE_MS, COVER_TRIES } from "./capture-tab";
import { CALL_DEADLINE_MS, sent } from "./cloud";
import type { Cloud, LinkSave, Saved, Sent } from "./cloud";
import { forgetConnection, readConnection } from "./connection";
import type { Session, SignIn } from "./sign-in";

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
  // the account it was made under, whose library alone it lands in
  email: z.string().min(1),
  // no try has gone unanswered yet, so the first may still be under way
  firstTry: z.boolean(),
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

// the cloud deleted the account `email` named: what waited for it can never land, and this browser
// no longer holds it, unless a sign-in as another account replaced it while the call was on its way
export const accountGone = async (email: string): Promise<void> => {
  const saves = await queuedSaves();
  await browser.storage.local.remove(saves.filter((save) => save.email === email).map(keyOf));
  const held = await readConnection();
  if (held?.email === email) {
    await forgetConnection();
  }
  await ensureSendAlarm();
};

// a try that went unanswered, or a session that ended: the save waits for the alarm
const markWaiting = async (save: QueuedSave): Promise<void> => {
  await keepSave({ ...save, firstTry: false });
};

// a waiting save as the link it is sent as: its title only where it has one
export const linkOf = (save: QueuedSave): LinkSave => {
  const link: LinkSave = { id: save.id, opId: save.opId, savedAt: save.savedAt, url: save.url };
  if (save.title !== "") {
    link.title = save.title;
  }
  return link;
};

type DropReason = Extract<OutcomeReason, "library-full" | "too-large" | "failed">;

// how a try left its save: landed, waiting to be sent again, let go, or gone with its account
export type Settled<T> =
  | { readonly kind: "landed"; readonly answer: T }
  | { readonly kind: "waiting"; readonly for: WaitsFor }
  | { readonly kind: "dropped"; readonly reason: DropReason }
  | { readonly kind: "gone" };

// a session's end waits for the person to sign in again or the browser to update the extension,
// which `storage.local` outlives, but nothing saved under a deleted account can land
const SESSION_ENDS = {
  gone: { kind: "gone" },
  outdated: { for: "update", kind: "waiting" },
  "signed-out": { for: "sign-in", kind: "waiting" },
} as const satisfies Record<SessionEnd, Settled<never>>;

// the refusals of the procedure's own a person can act on; any other no resend passes
const REFUSALS: ReadonlyMap<string, DropReason> = new Map([
  [PayloadTooLargeError.code, "too-large"],
  [QuotaError.code, "library-full"],
]);

// what a try's answer means for the save that made it, whichever try met it
export const settledBy = <T>(answer: Sent<T>): Settled<T> => {
  switch (answer.kind) {
    case "landed": {
      return answer;
    }
    case "session": {
      return SESSION_ENDS[answer.end];
    }
    // the cloud's budget for a minute, or no answer: a later try may pass
    case "busy":
    case "unreachable": {
      return { for: "connection", kind: "waiting" };
    }
    case "malformed": {
      return { kind: "dropped", reason: "failed" };
    }
    case "refused": {
      return { kind: "dropped", reason: REFUSALS.get(answer.code) ?? "failed" };
    }
    // no default
  }
};

// a kept save's try, the first or a resend, and the one place its answer moves the save
export const settle = async <T>(
  save: QueuedSave,
  send: () => Promise<Sent<T>>,
): Promise<Settled<T>> => {
  const settled = settledBy(await send());
  switch (settled.kind) {
    case "landed":
    case "dropped": {
      await dropSave(save);
      break;
    }
    case "waiting": {
      await markWaiting(save);
      break;
    }
    case "gone": {
      await accountGone(save.email);
      break;
    }
    // no default
  }
  return settled;
};

export interface SendDeps {
  readonly cloud: (session: Session) => Cloud;
  readonly now: () => number;
  // the cloud asked who this browser is signed in as, null when it did not answer
  readonly signIn: () => Promise<SignIn | null>;
}

// every save of the account signed in sent oldest first, until one cannot go yet: the cloud is not
// there, not for this build, or not for this session, so the rest wait with it. Another account's
// saves wait for that account, and a first try still under way for its own answer
export const sendQueued = async (deps: SendDeps): Promise<void> => {
  const saves = await queuedSaves();
  const signIn = saves.length === 0 ? null : await deps.signIn();
  if (signIn?.kind === "signed-in") {
    const cloud = deps.cloud(signIn.session);
    for (const save of saves) {
      const due = !save.firstTry || deps.now() - save.savedAt >= ABANDONED_MS;
      if (save.email !== signIn.session.email || !due) {
        continue;
      }
      const settled = await settle(
        save,
        async (): Promise<Sent<Saved>> =>
          await sent(async () => await cloud.saveLink(linkOf(save))),
      );
      if (settled.kind === "waiting" || settled.kind === "gone") {
        break;
      }
    }
  }
  await ensureSendAlarm();
};
