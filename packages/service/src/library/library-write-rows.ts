import { noteFields } from "@repo/contract/library/item-makes";
import { bodyWriteSchema, folderRowSchema } from "@repo/contract/library/library-wire";
import { organizedSchema } from "@repo/contract/rpc/library-contract";
import { TooManyRequestsError } from "@repo/contract/rpc/v1-errors";
import { z } from "zod";

import { editBody } from "../body/edit-body";
import { writeBody } from "../body/write-body";
import { reserveFile, settleFile } from "../files/file-landing";
import { spendHolderBudget } from "../rate-limit";
import { answer, writing } from "./library-access";
import { writeFolders } from "./library-folders";
import { IMPORT_ACTOR, importLandedSchema, landImported } from "./library-imports";
import {
  createFile,
  createNote,
  landedSummaries,
  landNew,
  organizeItems,
  purgeItems,
  refreshItem,
  setDeleted,
} from "./library-items";
import { libraryHead } from "./library-rows";
import { savedSchema, saveLink, savePage } from "./library-saves";
import { writeLibrary } from "./library-store";
import { sweepItems, sweptAnswerSchema } from "./library-sweeps";
import { undoneSchema, undoTurns } from "./library-undo";
import { landedSchema, landPropertyOps } from "./library-writes";

const ids = z.array(z.string());
const changedSchema = z.object({ addressHeld: ids, changed: ids, missing: ids });
const foldersWrittenSchema = z.object({ folders: z.array(folderRowSchema), seq: z.number() });
const purgedSchema = z.object({ missing: ids, purged: ids });

export const libraryWriteRows = {
  agent: {
    undo: writing.agent.undo.handler(async ({ context, input }) =>
      answer(
        await writeLibrary(
          context.library,
          { answer: undoneSchema, opId: undefined },
          async (scope) => await undoTurns(scope, input),
        ),
      ),
    ),
  },
  files: {
    reserve: writing.files.reserve.handler(async ({ context, input }) => {
      const spent = await spendHolderBudget("fileReserve", context.library.accountId);

      if (spent.kind === "refused") {
        throw new TooManyRequestsError();
      }

      return answer(await reserveFile(context.library, input));
    }),
    settle: writing.files.settle.handler(async ({ context, input }) =>
      answer(await settleFile(context.library, input)),
    ),
  },
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
  imports: {
    land: writing.imports.land.handler(async ({ context, input }) =>
      answer(
        await writeLibrary(
          { ...context.library, actor: IMPORT_ACTOR },
          { answer: importLandedSchema, opId: input.opId },
          async (scope) => await landImported(scope, input.items),
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
    createNote: writing.items.createNote.handler(async ({ context, input }) =>
      answer(
        await writeLibrary(
          context.library,
          { answer: landedSchema, opId: input.opId },
          async (scope) => ({ item: await createNote(scope, input) }),
        ),
      ),
    ),
    edit: writing.items.edit.handler(async ({ context, input }) =>
      answer(await editBody(context.library, input)),
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
    refresh: writing.items.refresh.handler(async ({ context, input }) =>
      answer(
        await writeLibrary(
          context.library,
          { answer: landedSchema, opId: input.opId },
          async (scope) => ({ item: await refreshItem(scope, input.id) }),
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
    saveBody: writing.items.saveBody.handler(async ({ context, input }) =>
      answer(
        await writeLibrary(
          context.library,
          { answer: bodyWriteSchema, opId: undefined },
          async (scope) =>
            await writeBody(scope, {
              baseVersion: input.baseVersion,
              blocks: input.blocks,
              itemId: input.id,
            }),
        ),
      ),
    ),
    sweep: writing.items.sweep.handler(async ({ context, input: { opId, verb, ...swept } }) =>
      answer(
        await writeLibrary(
          context.library,
          { answer: sweptAnswerSchema, opId },
          async (scope) => await sweepItems(scope, swept, verb),
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
