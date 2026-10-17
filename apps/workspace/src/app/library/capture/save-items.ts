// A save from the window: each link and file the payload holds, one at a time, into the folder
// the scope names (Unsorted unless a folder is shown). The server writes the item at once and
// fills a link's page in after, so a save answers before any page is read.

import type { LibraryScope } from "@repo/domain/library-scope";
import { UNSORTED_FOLDER } from "@repo/notes/items/item-kind";
import { basenamePath } from "@repo/notes/knowledge/vault-path";
import type {
  ItemSaveResponse,
  itemsSaveLinkRequestSchema,
} from "@repo/contract/local/items/items-schema";
import type { z } from "zod";
import { toast } from "@repo/ui/components/sonner";
import { plural } from "@repo/ui/lib/plural";

import { client, refusalMessage } from "../../api";
import type { CapturePayload, CapturedLink } from "./capture-payload";

type ItemsSaveLinkInput = z.input<typeof itemsSaveLinkRequestSchema>;

// where a save from this scope lands: the folder shown, else Unsorted
export const captureDir = (scope: LibraryScope): string =>
  scope.kind === "folder" ? scope.path : UNSORTED_FOLDER;

const saveLinkItem = async (link: CapturedLink, folder: string): Promise<ItemSaveResponse> => {
  const request: ItemsSaveLinkInput = { folder, url: link.url };
  if (link.title !== null) {
    request.title = link.title;
  }
  return await client.items.saveLink(request);
};

const saveFileItem = async (file: File, folder: string): Promise<ItemSaveResponse> =>
  await client.items.saveFile({ file, folder, name: file.name });

export interface SaveOutcomeActions {
  // the item a toast offers to open: the one just saved, or the one already holding the link
  open: (path: string) => void;
}

const folderName = (folder: string): string =>
  folder === "" ? "your library" : basenamePath(folder);

// what the toasts say once the payload has gone: one item is named, many are counted
export const savePayload = async (
  payload: CapturePayload,
  folder: string,
  actions: SaveOutcomeActions,
): Promise<ItemSaveResponse[]> => {
  for (const sentence of new Set(payload.refused)) {
    toast.error(sentence);
  }
  const answers: ItemSaveResponse[] = [];
  const jobs: (() => Promise<ItemSaveResponse>)[] = [
    ...payload.urls.map((link) => async () => await saveLinkItem(link, folder)),
    ...payload.files.map((file) => async () => await saveFileItem(file, folder)),
  ];
  for (const job of jobs) {
    try {
      answers.push(await job());
    } catch (error) {
      toast.error(refusalMessage(error, "That couldn't be saved."));
    }
  }
  const created = answers.filter((answer) => answer.outcome === "created");
  const existing = answers.filter((answer) => answer.outcome === "exists");
  const [first] = created;
  if (created.length === 1 && first !== undefined) {
    toast.success(`Saved to ${folderName(folder)}`, {
      action: {
        label: "Open",
        onClick: () => {
          actions.open(first.path);
        },
      },
    });
  } else if (created.length > 1) {
    toast.success(`Saved ${plural(created.length, "item")} to ${folderName(folder)}`);
  }
  const [held] = existing;
  if (existing.length === 1 && held !== undefined) {
    toast.info("Already in your library", {
      action: {
        label: "Show",
        onClick: () => {
          actions.open(held.path);
        },
      },
    });
  } else if (existing.length > 1) {
    toast.info(`${plural(existing.length, "item")} already in your library`);
  }
  return answers;
};
