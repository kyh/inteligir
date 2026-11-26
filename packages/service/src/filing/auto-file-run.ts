import { canHoldKind } from "@repo/contract/items/item-kind";
import { organized } from "@repo/contract/library/cell-rules";
import { db } from "@repo/db/drizzle-client";
import { itemSearch, job } from "@repo/db/library-schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { agentEnabled, filingRulesFor } from "../agent/agent-preference";
import { autoFileJobSchema } from "../library/auto-file-job";
import type { AutoFileJob } from "../library/auto-file-job";
import type { JobRun } from "../library/job-queue";
import { listingScopes } from "../library/library-listing";
import { readItem } from "../library/library-rows";
import type { StoredItem } from "../library/library-rows";
import type { LibraryWriter } from "../library/library-store";
import { writeLibrary } from "../library/library-store";
import { landFields } from "../library/library-writes";
import { ITEM_FIELD_CAPS } from "@repo/contract/items/item-field-caps";

import { askFiling } from "./filing-ask";
import type { FilingAnswer, FilingAsk } from "./filing-ask";

const AUTO_FILE_TRIES = 6;

const TAGS_OFFERED = 300;

const SUMMARY_MAX = 400;

const TAGS_KEPT = 3;

const filedSchema = z.enum(["filed", "stale"]);

interface Container {
  readonly id: string;
  readonly kind: "folder" | "list";
  readonly parentId: string | null;
  readonly title: string;
}

const pathsOf = (containers: readonly Container[], held: StoredItem) => {
  const byId = new Map(containers.map((container) => [container.id, container]));

  const pathOf = (container: Container) => {
    const names: string[] = [];
    const seen = new Set<string>();

    for (
      let at: Container | undefined = container;
      at !== undefined && !seen.has(at.id);
      at = at.parentId === null ? undefined : byId.get(at.parentId)
    ) {
      seen.add(at.id);
      names.unshift(at.title.replaceAll("/", "-"));
    }

    return names.join("/");
  };

  return new Map(
    containers.flatMap((container) =>
      canHoldKind(container.kind, held.fields.kind) ? [[pathOf(container), container.id]] : [],
    ),
  ) satisfies ReadonlyMap<string, string>;
};

const stillWaits = async (accountId: string, held: StoredItem) => {
  if (held.fields.url !== null && held.fields.reading.state === "pending") {
    return true;
  }

  const [text] = await db
    .select({ id: job.id })
    .from(job)
    .where(and(eq(job.accountId, accountId), eq(job.id, `file-text:${held.id}`)));

  return text !== undefined;
};

const searchTextOf = async (accountId: string, itemId: string) => {
  const [row] = await db
    .select({ text: itemSearch.text })
    .from(itemSearch)
    .where(and(eq(itemSearch.accountId, accountId), eq(itemSearch.itemId, itemId)));

  return row?.text ?? "";
};

interface Filing {
  readonly folderId: string | null;
  readonly summary: string | null;
  readonly tags: readonly string[];
}

const landFiling = async (writer: LibraryWriter, read: StoredItem, filing: Filing) =>
  await writeLibrary(writer, { answer: filedSchema, opId: undefined }, async (scope) => {
    const held = await readItem(scope.tx, scope.accountId, read.id);

    if (held === null || held.fields.deletedAt !== null) {
      return "stale";
    }

    const parentId =
      held.fields.parentId === null && filing.folderId !== null ? filing.folderId : undefined;

    const description =
      filing.summary !== null && held.fields.description === read.fields.description
        ? filing.summary
        : held.fields.description;

    const filed = organized(
      held.fields,
      { addTags: filing.tags, ids: [held.id] },
      parentId,
      scope.now,
    );

    await landFields(scope, held, { ...filed, description });

    return "filed";
  });

const summaryOf = (answer: FilingAnswer) => {
  const summary = answer.summary.replaceAll(/\s+/gu, " ").trim().slice(0, SUMMARY_MAX);

  return summary === "" ? null : summary.slice(0, ITEM_FIELD_CAPS.description);
};

type Filer = (ask: FilingAsk) => Promise<FilingAnswer | null>;

export const autoFileRun = (filer: Filer) =>
  ({
    payload: autoFileJobSchema,
    run: async ({ itemId }, { accountId }) => {
      if (!(await agentEnabled(accountId))) {
        return "done";
      }

      const held = await readItem(db, accountId, itemId);

      if (held === null || held.fields.deletedAt !== null) {
        return "done";
      }

      if (await stillWaits(accountId, held)) {
        return "retry";
      }

      const scopes = await listingScopes(db, accountId);
      const folders = pathsOf(scopes.containers, held);
      const tags = scopes.tags.slice(0, TAGS_OFFERED).map(({ tag }) => tag);

      const answer = await filer({
        folders: [...folders.keys()],
        rules: await filingRulesFor(accountId),
        tags,
        text: await searchTextOf(accountId, itemId),
        title: held.fields.title,
        url: held.fields.url,
      });

      if (answer === null) {
        return "done";
      }

      const writer = { accountId, actor: { kind: "fill" } } satisfies LibraryWriter;

      const landed = await landFiling(writer, held, {
        folderId: answer.folder === null ? null : (folders.get(answer.folder) ?? null),
        summary: summaryOf(answer),
        tags: answer.tags.filter((tag) => tags.includes(tag)).slice(0, TAGS_KEPT),
      });

      return !landed.ok && landed.refusal.kind === "busy" ? "retry" : "done";
    },
    tries: {
      exhausted: async ({ itemId }) => {
        await Promise.resolve();
        console.warn({ event: "auto-file-gave-up", itemId });
      },
      kind: "at-most",
      max: AUTO_FILE_TRIES,
    },
  }) satisfies JobRun<AutoFileJob>;

export const AUTO_FILE_RUN = autoFileRun(askFiling);
