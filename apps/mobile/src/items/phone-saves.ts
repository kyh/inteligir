import type { SaveStamp } from "@repo/client/waiting-saves";
import { outcomeOf } from "@repo/contract/rpc/call-outcome";
import type { CallOutcome } from "@repo/contract/rpc/call-outcome";
import type { V1Client } from "@repo/contract/rpc/v1-contract";
import { WEB_URL_RULE } from "@repo/contract/items/item-kind";
import { isWebUrl } from "@repo/contract/items/item-url";
import type { FileCache, HeldFile } from "../files/file-cache";
import { linkInText } from "./link-in-text";
import type { ShareSave } from "./share-payload";

interface SaveTarget {
  readonly parentId: string | null;
}

export type SaveOutcome = CallOutcome<{ readonly id: string; readonly created: boolean }>;

type SharedLink = Omit<Extract<ShareSave, { kind: "link" }>, "kind">;

export interface PhoneSaves {
  readonly stamp: () => SaveStamp;
  readonly saveLink: (
    link: SharedLink,
    target: SaveTarget,
    stamp?: SaveStamp,
  ) => Promise<SaveOutcome>;
  readonly saveText: (text: string, target: SaveTarget, stamp?: SaveStamp) => Promise<SaveOutcome>;
  readonly newNote: (target: SaveTarget) => Promise<SaveOutcome>;
  readonly keepFile: (file: HeldFile) => Promise<CallOutcome<string>>;
  readonly addFile: (
    file: HeldFile & { readonly name: string },
    target: SaveTarget,
  ) => Promise<SaveOutcome>;
}

export interface PhoneSavesArgs {
  readonly client: V1Client;
  readonly upload: (file: HeldFile & { readonly sha: string }) => Promise<void>;
  readonly files: Pick<FileCache, "keep">;
  readonly newId: () => string;
  readonly newBlockId: () => string;
  readonly now: () => number;
  readonly sha256Hex: (bytes: Uint8Array<ArrayBuffer>) => Promise<string>;
}

const NOTHING_TO_SAVE = "Type a link or a thought to save.";

const TITLE_MAX = 120;

const firstLine = (text: string) => text.split(/\r?\n/u).find((line) => line.trim() !== "") ?? "";

const paragraphsOf = (text: string, newBlockId: () => string) =>
  text
    .split(/\r?\n\s*\r?\n/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "")
    .map((paragraph) => ({ children: [{ text: paragraph }], id: newBlockId(), type: "p" }));

const refused = (message: string) =>
  ({
    code: "BAD_REQUEST",
    kind: "refused",
    message,
  }) satisfies SaveOutcome;

const answered = async (
  call: () => Promise<{ readonly item: { readonly id: string }; readonly created?: boolean }>,
) =>
  await outcomeOf(async () => {
    const { created = true, item } = await call();

    return { created, id: item.id };
  });

export const createPhoneSaves = (args: PhoneSavesArgs) => {
  const { library } = args.client;

  const stamp = () =>
    ({ id: args.newId(), opId: args.newId(), savedAt: args.now() }) satisfies SaveStamp;

  const saveLink: PhoneSaves["saveLink"] = async (link, { parentId }, ids = stamp()) => {
    if (!isWebUrl(link.url)) {
      return refused(WEB_URL_RULE);
    }

    return await answered(
      async () =>
        await library.items.saveLink({
          parent: parentId === null ? null : { id: parentId },
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

    const sent = await outcomeOf(async () => {
      await args.upload({ bytes, mime, sha });

      return sha;
    });

    if (sent.kind === "landed") {
      await args.files.keep(sha, { bytes, mime });
    }

    return sent;
  };

  return {
    addFile: async ({ bytes, mime, name }, { parentId }) => {
      const ids = stamp();
      const kept = await keepFile({ bytes, mime });

      if (kept.kind !== "landed") {
        return kept;
      }

      return await answered(
        async () =>
          await library.items.createFile({
            parentId,
            id: ids.id,
            name,
            opId: ids.opId,
            savedAt: ids.savedAt,
            sha: kept.answer,
            tags: [],
          }),
      );
    },
    keepFile,
    newNote: async ({ parentId }) => {
      const ids = stamp();

      return await answered(
        async () =>
          await library.items.create({
            blocks: [],
            parentId,
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
        return refused(NOTHING_TO_SAVE);
      }

      const link = linkInText(trimmed);

      if (link !== null) {
        return await saveLink(
          { note: link.rest === "" ? null : link.rest, title: null, url: link.url },
          target,
          ids,
        );
      }

      return await answered(
        async () =>
          await library.items.create({
            blocks: paragraphsOf(trimmed, args.newBlockId).map((block) => ({
              block,
              section: "note" as const,
            })),
            parentId: target.parentId,
            id: ids.id,
            opId: ids.opId,
            savedAt: ids.savedAt,
            tags: [],
            title: firstLine(trimmed).slice(0, TITLE_MAX),
          }),
      );
    },
    stamp,
  } satisfies PhoneSaves;
};
