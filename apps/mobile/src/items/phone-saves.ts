// Saving from the phone, each one create the cloud answers: a link is a save the cloud reads (its
// fill), a thought a note named by its first line, a photo or a file an item of its own whose bytes
// go up first, each where the Library's scope saves. A link whose address an item already holds
// answers that item and changes nothing. Every save names its item's id and an op id minted before
// its first call, so a resend after a lost answer lands once. A file a note's text names is sent up
// by its sha the same way, before the write naming it. A save never throws: it answers what became
// of it. Platform-free: the suites and the scenario suite run it under node.

import { CHANGE_REFUSED, sharedFailure } from "@repo/contract/cloud/library/call-outcome";
import type { UploadOutcome } from "@repo/contract/cloud/library/call-outcome";
import { refusalText } from "@repo/contract/cloud/refusal-text";
import type { V1Client } from "@repo/contract/cloud/v1";
import { WEB_URL_RULE } from "@repo/notes/items/item-kind";
import { isWebUrl } from "@repo/notes/items/item-url";
import { ordsBetween } from "@repo/notes/library/block-order";
import type { FileCache, HeldFile } from "../files/file-cache";
import { linkInText } from "./link-in-text";

// where a save lands: the scope's folder, or Unsorted
interface SaveTarget {
  readonly folderId: string | null;
}

// the ids a save names and when it was made, minted before its first call
interface SaveStamp {
  readonly id: string;
  readonly opId: string;
  readonly savedAt: number;
}

export type SaveOutcome =
  // `created` false: an item already held the address, and is answered as it stands
  | { readonly kind: "saved"; readonly id: string; readonly created: boolean }
  // no resend lands it as it is, said in the person's words
  | { readonly kind: "refused"; readonly message: string }
  // the cloud did not answer (offline, busy, a fault of its own): the same save may go again
  | { readonly kind: "unreachable" }
  // the sign-in ended under it
  | { readonly kind: "ended" };

// a file's bytes sent up and kept on the phone as they went, or why not
type KeepOutcome =
  | { readonly kind: "kept"; readonly sha: string }
  | Exclude<SaveOutcome, { readonly kind: "saved" }>;

interface SharedLink {
  readonly url: string;
  readonly title: string | null;
  readonly note: string | null;
}

export interface PhoneSaves {
  readonly stamp: () => SaveStamp;
  readonly saveLink: (
    link: SharedLink,
    target: SaveTarget,
    stamp?: SaveStamp,
  ) => Promise<SaveOutcome>;
  // a web link inside is saved as that link, the rest of the text its note; any other text is a
  // note named by its first line
  readonly saveText: (text: string, target: SaveTarget, stamp?: SaveStamp) => Promise<SaveOutcome>;
  // an empty note, its title to be typed
  readonly newNote: (target: SaveTarget) => Promise<SaveOutcome>;
  // a file's bytes up by their sha, and kept on the phone as they went
  readonly keepFile: (file: HeldFile) => Promise<KeepOutcome>;
  // a photo or a file: its bytes kept, then its item
  readonly addFile: (
    file: HeldFile & { readonly name: string },
    target: SaveTarget,
  ) => Promise<SaveOutcome>;
}

export interface PhoneSavesArgs {
  readonly client: V1Client;
  readonly upload: (file: HeldFile & { readonly sha: string }) => Promise<UploadOutcome>;
  readonly files: Pick<FileCache, "keep">;
  // a fresh UUIDv7, which an item's id and an op id both are
  readonly newId: () => string;
  readonly newBlockId: () => string;
  readonly now: () => number;
  readonly sha256Hex: (bytes: Uint8Array<ArrayBuffer>) => Promise<string>;
}

/** @internal */
const NOTHING_TO_SAVE = "Type a link or a thought to save.";

// a title is one line, and a card's title at most this long
const TITLE_MAX = 120;

const firstLine = (text: string): string =>
  text.split(/\r?\n/u).find((line) => line.trim() !== "") ?? "";

// a thought's paragraphs, one block each, in order; each line break inside one kept
const paragraphsOf = (text: string, newBlockId: () => string) =>
  text
    .split(/\r?\n\s*\r?\n/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "")
    .map((paragraph) => ({ children: [{ text: paragraph }], id: newBlockId(), type: "p" }));

// what a call that threw met, in the save's terms
const failedWith = (cause: unknown): SaveOutcome => {
  const failure = cause instanceof Error ? sharedFailure(cause) : null;
  if (failure === null) {
    return { kind: "refused", message: refusalText(cause, CHANGE_REFUSED) };
  }
  switch (failure.kind) {
    case "session": {
      return { kind: "ended" };
    }
    case "malformed": {
      return { kind: "refused", message: failure.message };
    }
    case "busy":
    case "unreachable": {
      return { kind: "unreachable" };
    }
    // no default
  }
};

const answered = async (
  call: () => Promise<{ readonly item: { readonly id: string }; readonly created?: boolean }>,
): Promise<SaveOutcome> => {
  try {
    const { created = true, item } = await call();
    return { created, id: item.id, kind: "saved" };
  } catch (error) {
    return failedWith(error);
  }
};

export const createPhoneSaves = (args: PhoneSavesArgs): PhoneSaves => {
  const { library } = args.client;

  const stamp = (): SaveStamp => ({ id: args.newId(), opId: args.newId(), savedAt: args.now() });

  const saveLink: PhoneSaves["saveLink"] = async (link, { folderId }, ids = stamp()) => {
    if (!isWebUrl(link.url)) {
      return { kind: "refused", message: WEB_URL_RULE };
    }
    return await answered(
      async () =>
        await library.items.saveLink({
          folder: folderId === null ? null : { id: folderId },
          id: ids.id,
          opId: ids.opId,
          note: link.note ?? undefined,
          savedAt: ids.savedAt,
          title: link.title ?? undefined,
          url: link.url,
        }),
    );
  };

  const keepFile: PhoneSaves["keepFile"] = async ({ bytes, mime }) => {
    const sha = await args.sha256Hex(bytes);
    const sent = await args.upload({ bytes, mime, sha });
    if (sent.kind === "refused") {
      return { kind: "refused", message: sent.reason };
    }
    if (sent.kind === "failed") {
      return sent.failure.kind === "session" ? { kind: "ended" } : { kind: "unreachable" };
    }
    await args.files.keep(sha, { bytes, mime });
    return { kind: "kept", sha };
  };

  return {
    addFile: async ({ bytes, mime, name }, { folderId }) => {
      const ids = stamp();
      const kept = await keepFile({ bytes, mime });
      if (kept.kind !== "kept") {
        return kept;
      }
      return await answered(
        async () =>
          await library.items.createFile({
            folderId,
            id: ids.id,
            name,
            opId: ids.opId,
            savedAt: ids.savedAt,
            sha: kept.sha,
            tags: [],
          }),
      );
    },
    keepFile,
    newNote: async ({ folderId }) => {
      const ids = stamp();
      return await answered(
        async () =>
          await library.items.create({
            blocks: [],
            folderId,
            id: ids.id,
            opId: ids.opId,
            savedAt: ids.savedAt,
            tags: [],
            title: "",
          }),
      );
    },
    saveLink,
    saveText: async (text, target, ids = stamp()) => {
      const trimmed = text.trim();
      if (trimmed === "") {
        return { kind: "refused", message: NOTHING_TO_SAVE };
      }
      const link = linkInText(trimmed);
      if (link !== null) {
        return await saveLink(
          { note: link.rest === "" ? null : link.rest, title: null, url: link.url },
          target,
          ids,
        );
      }
      const blocks = paragraphsOf(trimmed, args.newBlockId);
      const ords = ordsBetween(null, null, blocks.length);
      return await answered(
        async () =>
          await library.items.create({
            blocks: blocks.flatMap((block, index) => {
              const ord = ords[index];
              return ord === undefined ? [] : [{ block, ord, section: "note" as const }];
            }),
            folderId: target.folderId,
            id: ids.id,
            opId: ids.opId,
            savedAt: ids.savedAt,
            tags: [],
            title: firstLine(trimmed).slice(0, TITLE_MAX),
          }),
      );
    },
    stamp,
  };
};
