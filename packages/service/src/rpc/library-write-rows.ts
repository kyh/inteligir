import { bodyWriteSchema } from "@repo/contract/library/library-wire";
import { organizedSchema } from "@repo/contract/rpc/library-contract";
import { TooManyRequestsError } from "@repo/contract/rpc/v1-errors";
import { z } from "zod";

import { editBody } from "../body/edit-body";
import { writeBody } from "../body/write-body";
import { reserveFile, settleFile } from "../files/file-landing";
import { spendHolderBudget } from "../rate-limit";
import { answer, writing } from "../library/library-access";
import { IMPORT_ACTOR, importLandedSchema, landImported } from "../library/library-imports";
import {
  createFile,
  createItem,
  createNote,
  landedSummaries,
  organizeItems,
  purgeItems,
  refreshItem,
  saveEditedFile,
  setDeleted,
  setList,
} from "../library/library-items";
import { savedSchema, saveLink, savePage } from "../library/library-saves";
import { writeLibrary } from "../library/library-store";
import { sweepItems, sweptAnswerSchema } from "../library/library-sweeps";
import { undoTurns } from "../library/library-undo";
import { landedSchema, landPropertyOps } from "../library/library-writes";
import { removeView, saveView } from "../library/saved-views";

const ids = z.array(z.string());
const changedSchema = z.object({ addressHeld: ids, changed: ids, missing: ids });
const purgedSchema = z.object({ missing: ids, purged: ids });
const seqSchema = z.object({ seq: z.number() });

export const libraryWriteRows = {
  agent: {
    undo: writing.agent.undo.handler(async ({ context, input }) =>
      answer(await undoTurns(context.library, input)),
    ),
  },
  files: {
    reserve: writing.files.reserve.handler(async ({ context, input }) => {
      const spent = await spendHolderBudget("fileReserve", context.library.accountId);

      if (spent.kind === "refused") {
        const { retryAfterSeconds } = spent;
        throw new TooManyRequestsError({ data: { retryAfterSeconds } });
      }

      return answer(await reserveFile(context.library, input));
    }),
    settle: writing.files.settle.handler(async ({ context, input }) =>
      answer(await settleFile(context.library, input)),
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
          async (scope) => ({ item: await createItem(scope, input) }),
        ),
      ),
    ),
    setList: writing.items.setList.handler(async ({ context, input }) =>
      answer(
        await writeLibrary(
          context.library,
          { answer: landedSchema, opId: input.opId },
          async (scope) => ({ item: await setList(scope, input) }),
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
    saveEdited: writing.items.saveEdited.handler(async ({ context, input }) =>
      answer(
        await writeLibrary(
          context.library,
          { answer: landedSchema, opId: input.opId },
          async (scope) => ({ item: await saveEditedFile(scope, input) }),
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
  views: {
    remove: writing.views.remove.handler(async ({ context, input }) =>
      answer(
        await writeLibrary(
          context.library,
          { answer: seqSchema, opId: input.opId },
          async (scope) => await removeView(scope, input.id),
        ),
      ),
    ),
    save: writing.views.save.handler(async ({ context, input }) =>
      answer(
        await writeLibrary(
          context.library,
          { answer: seqSchema, opId: input.opId },
          async (scope) => await saveView(scope, input.view),
        ),
      ),
    ),
  },
};
