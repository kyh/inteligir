// The library's rows that write, routed beside the ones that read (`../rpc/library-router`): each
// side keeps a module of its own, and `items` holds rows of both. Every write lands through the
// store in one transaction under the account's lock (`./library-store`), answered under its op id
// when it names one, and every refusal as the error its row declares (`./library-access`).

import { noteFields } from "@repo/contract/library/item-makes";
import { folderRowSchema, itemSummarySchema } from "@repo/contract/library/library-wire";
import { z } from "zod";

import { answer, writing } from "./library-access";
import { writeFolders } from "./library-folders";
import {
  createFile,
  landedSummaries,
  landNew,
  organizeItems,
  purgeItems,
  setDeleted,
} from "./library-items";
import { libraryHead } from "./library-rows";
import { savedSchema, saveLink, savePage } from "./library-saves";
import { writeLibrary } from "./library-store";
import { landedSchema, landPropertyOps } from "./library-writes";

const ids = z.array(z.string());
const changedSchema = z.object({ addressHeld: ids, changed: ids, missing: ids });
const foldersWrittenSchema = z.object({ folders: z.array(folderRowSchema), seq: z.number() });
const organizedSchema = z.object({ items: z.array(itemSummarySchema) });
const purgedSchema = z.object({ missing: ids, purged: ids });

export const libraryWriteRows = {
  folders: {
    write: writing.folders.write.handler(async ({ context, input }) =>
      answer(
        await writeLibrary(
          context.library,
          { answer: foldersWrittenSchema, opId: input.opId },
          async (scope) => {
            const folders = await writeFolders(scope, input.ops);
            return { folders, seq: await libraryHead(scope.tx, scope.accountId) };
          },
        ),
      ),
    ),
  },
  items: {
    create: writing.items.create.handler(async ({ context, input }) =>
      answer(
        await writeLibrary(
          context.library,
          { answer: landedSchema, opId: input.opId },
          async (scope) => ({
            item: await landNew(scope, {
              blocks: input.blocks,
              fields: noteFields(input),
              id: input.id,
            }),
          }),
        ),
      ),
    ),
    createFile: writing.items.createFile.handler(async ({ context, input }) =>
      answer(
        await writeLibrary(
          context.library,
          { answer: landedSchema, opId: input.opId },
          async (scope) => ({ item: await createFile(scope, input) }),
        ),
      ),
    ),
    delete: writing.items.delete.handler(async ({ context, input }) => {
      const { changed, missing } = answer(
        await writeLibrary(
          context.library,
          { answer: changedSchema, opId: input.opId },
          async (scope) => await setDeleted(scope, { deleted: true, ids: input.ids }),
        ),
      );
      return { deleted: changed, missing };
    }),
    organize: writing.items.organize.handler(async ({ context, input }) =>
      answer(
        await writeLibrary(
          context.library,
          { answer: organizedSchema, opId: input.opId },
          async (scope) => ({
            items: await landedSummaries(scope, await organizeItems(scope, input)),
          }),
        ),
      ),
    ),
    purge: writing.items.purge.handler(async ({ context, input }) =>
      answer(
        await writeLibrary(
          context.library,
          { answer: purgedSchema, opId: input.opId },
          async (scope) => await purgeItems(scope, input.ids),
        ),
      ),
    ),
    restore: writing.items.restore.handler(async ({ context, input }) => {
      const { addressHeld, changed, missing } = answer(
        await writeLibrary(
          context.library,
          { answer: changedSchema, opId: input.opId },
          async (scope) => await setDeleted(scope, { deleted: false, ids: input.ids }),
        ),
      );
      return { addressHeld, missing, restored: changed };
    }),
    save: writing.items.save.handler(async ({ context, input }) =>
      answer(
        await writeLibrary(
          context.library,
          { answer: savedSchema, opId: input.opId },
          async (scope) => await savePage(scope, input),
        ),
      ),
    ),
    saveLink: writing.items.saveLink.handler(async ({ context, input }) =>
      answer(
        await writeLibrary(
          context.library,
          { answer: savedSchema, opId: input.opId },
          async (scope) => await saveLink(scope, input),
        ),
      ),
    ),
  },
  write: writing.write.handler(async ({ context, input }) =>
    answer(
      await writeLibrary(
        context.library,
        { answer: landedSchema, opId: input.opId },
        async (scope) => ({ item: await landPropertyOps(scope, input) }),
      ),
    ),
  ),
};
