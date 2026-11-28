import { paragraph } from "@repo/contract/test-support/library-items.test-utils";
import { agentPreference } from "@repo/db/agent-schema";
import { db } from "@repo/db/drizzle-client";
import { dbSuite } from "@repo/db/test-database";
import { expect, it } from "vitest";

import { drainJobs } from "../jobs/drain-jobs";
import { JOB_RUNS, leasedRun } from "../jobs/job-kinds";
import { mintLibraryId } from "../library/library-ids";
import { readItem } from "../library/library-rows";
import { createFolder, personalLibrary } from "../test-support/library.fixture";
import { autoFileRun } from "./auto-file-run";
import type { FilingAnswer, FilingAsk } from "./filing-ask";

const SETTLED_MS = 60_000;

const FACTS = { author: null, description: null, lang: null, published: null, site: null };

const pageSave = (url: string, words: string) => ({
  article: [paragraph(`p-${mintLibraryId(Date.now())}`, words)],
  coverSha: null,
  facts: FACTS,
  id: mintLibraryId(Date.now()),
  parentId: null,
  savedAt: Date.now(),
  tags: [],
  title: "Ten-minute miso soup",
  url,
});

const filer = (answer: FilingAnswer) => {
  const asked: FilingAsk[] = [];

  return {
    asked,
    filer: async (ask: FilingAsk) => {
      asked.push(ask);

      return await Promise.resolve(answer);
    },
  };
};

const drainedWith = async (accountId: string, run: ReturnType<typeof autoFileRun>) =>
  await drainJobs({
    accountId,
    budgetMs: 10_000,
    clock: () => Date.now() + SETTLED_MS,
    runs: { ...JOB_RUNS, "auto-file": leasedRun(run) },
  });

const kitchen = async () => {
  const { accountId, library } = await personalLibrary();
  const recipes = await createFolder(library, "Recipes");
  await createFolder(library, "Reading");
  await library.items.save({
    ...pageSave("https://example.com/tagged", "Bread."),
    tags: ["food"],
  });

  return { accountId, library, recipes };
};

dbSuite("filing a saved page", () => {
  it("files it in a folder the library has, sums it up and adds only tags the library uses", async () => {
    const { accountId, library, recipes } = await kitchen();

    const { item } = await library.items.save(
      pageSave("https://example.com/miso", "Whisk miso into hot dashi and add tofu."),
    );

    const { asked, filer: answered } = filer({
      folder: "Recipes",
      summary: "  A quick miso soup.\n\nDashi, miso and tofu. ",
      tags: ["food", "soup"],
    });

    await expect(drainedWith(accountId, autoFileRun(answered))).resolves.toMatchObject({
      failed: 0,
    });

    expect(asked.filter(({ url }) => url === "https://example.com/miso")).toMatchObject([
      {
        folders: ["Reading", "Recipes"],
        tags: ["food"],
        title: "Ten-minute miso soup",
        url: "https://example.com/miso",
      },
    ]);
    expect(asked.at(-1)?.text).toContain("Whisk miso into hot dashi");
    await expect(readItem(db, accountId, item.id)).resolves.toMatchObject({
      fields: {
        description: "A quick miso soup. Dashi, miso and tofu.",
        parentId: recipes,
        tags: ["food"],
      },
    });
  });

  it("keeps where the person filed it meanwhile, and a folder nobody made stays unsorted", async () => {
    const { accountId, library } = await kitchen();
    const reading = await createFolder(library, "Later");
    const filed = await library.items.save(pageSave("https://example.com/filed", "Soup."));
    const loose = await library.items.save(pageSave("https://example.com/loose", "Soup."));
    await library.items.organize({ ids: [filed.item.id], parent: { id: reading } });

    const { filer: answered } = filer({ folder: "Soups", summary: "Soup.", tags: [] });
    await drainedWith(accountId, autoFileRun(answered));

    await expect(readItem(db, accountId, filed.item.id)).resolves.toMatchObject({
      fields: { parentId: reading },
    });
    await expect(readItem(db, accountId, loose.item.id)).resolves.toMatchObject({
      fields: { description: "Soup.", parentId: null },
    });
  });

  it("asks nothing of an account whose agent is off", async () => {
    const { accountId, library } = await kitchen();
    await db.insert(agentPreference).values({ accountId, enabled: false });
    const { item } = await library.items.save(pageSave("https://example.com/off", "Soup."));
    const { asked, filer: answered } = filer({ folder: "Recipes", summary: "Soup.", tags: [] });

    await drainedWith(accountId, autoFileRun(answered));

    expect(asked).toStrictEqual([]);
    await expect(readItem(db, accountId, item.id)).resolves.toMatchObject({
      fields: { description: null, parentId: null },
    });
  });
});
