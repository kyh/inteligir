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
const RETRY_MINUTES = 0.5;

const keptSchema = z.strictObject({
  email: z.string().min(1),
  title: z.string(),
  url: z.string().min(1),
});

export type QueuedSave = WaitingSave<z.infer<typeof keptSchema>>;

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

const saves = waitingSaves({ payload: keptSchema, prefix: "save:", storage });

export const queuedSaves = saves.list;

export const keepSave = async (save: QueuedSave) => {
  await saves.keep(save, save.payload);
};

export const accountGone = async (email: string) => {
  await saves.clear((save) => save.payload.email === email);
  const held = await readConnection();

  if (held?.email === email) {
    await forgetConnection();
  }
};

export const linkOf = (save: QueuedSave) => {
  const { title, url } = save.payload;

  return { id: save.id, opId: save.opId, savedAt: save.savedAt, title, url } satisfies LinkSave;
};

const trying = new Set<string>();
let unanswered = 0;

const joinRefused = async (save: QueuedSave, outcome: CallOutcome<unknown>) => {
  const { email, url } = save.payload;
  const all = await saves.list();

  const [held, ...also] = all.filter(
    (kept) =>
      kept.refused !== null &&
      kept.opId !== save.opId &&
      kept.payload.email === email &&
      kept.payload.url === url,
  );

  if (held === undefined) {
    return;
  }

  for (const joined of [save, ...also]) {
    await saves.discard(joined.opId);
  }

  await saves.settle(held.opId, outcome);
};

const met = async <T>(save: QueuedSave, outcome: CallOutcome<T>) => {
  if (outcome.kind === "gone") {
    await accountGone(save.payload.email);
  } else if (outcome.kind === "refused") {
    await joinRefused(save, outcome);
  } else if (outcome.kind === "wait" && outcome.for === "connection") {
    unanswered += 1;
  }

  return outcome;
};

const holdAlarm = async () => {
  await browser.alarms.create(SEND_ALARM, { periodInMinutes: RETRY_MINUTES });
};

export const sendKept = async <T>(save: QueuedSave, send: () => Promise<CallOutcome<T>>) => {
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
  readonly signIn: () => Promise<SignIn | null>;
}

type Sender =
  | { readonly kind: "account"; readonly email: string; readonly cloud: Cloud }
  | { readonly kind: "wait"; readonly for: "connection" | "sign-in" };

const senderOf = async (deps: SendDeps) => {
  const signIn = await deps.signIn();

  if (signIn === null) {
    return { for: "connection", kind: "wait" } satisfies Sender;
  }

  return (
    signIn.kind === "signed-in"
      ? { cloud: deps.cloud(signIn.session), email: signIn.session.email, kind: "account" }
      : { for: "sign-in", kind: "wait" }
  ) satisfies Sender;
};

const SKIPPED = { kind: "skipped" } as const;

const sendPass = async (deps: SendDeps) => {
  const before = unanswered;
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

export const sendQueued = oneAtATime(sendPass);

export const heldSaves = async (email: string) => {
  const all = await saves.list();
  const kept = all.filter(({ payload }) => payload.email === email);

  return {
    refused: kept.flatMap(({ opId, payload, refused }) =>
      refused === null
        ? []
        : [{ message: refused, name: payload.title === "" ? payload.url : payload.title, opId }],
    ),
    waiting: kept.filter(({ refused }) => refused === null).length,
  } satisfies HeldSaves;
};

export const retrySave = saves.retry;

export const discardSave = saves.discard;
