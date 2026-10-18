import { ORPCError, safe } from "@orpc/client";
import {
  KNOWLEDGE_RELATED_MAX_LIMIT,
  knowledgeBacklinksResponseSchema,
  knowledgeItemPathsResponseSchema,
  knowledgeItemsResponseSchema,
  knowledgePathForNoteIdResponseSchema,
  knowledgeScopesResponseSchema,
  knowledgeRelatedResponseSchema,
  knowledgeSearchResponseSchema,
  knowledgeTagsResponseSchema,
} from "@repo/contract/local/knowledge/knowledge-schema";
import { describe, expect, it, vi } from "vitest";
import { bootTestApp } from "../../__tests__/boot-app";

describe("the knowledge routes", () => {
  it("searches, composes tag: terms, and answers backlinks and tags", async () => {
    const { client } = await bootTestApp();
    await client.vault.write({
      content: "# Alpha\n\nMentions [[beta]] and #project quokka work.\n",
      guard: { kind: "overwrite" },
      path: "alpha.md",
    });
    await client.vault.write({
      content: "# Beta\n\nQuokka research.\n",
      guard: { kind: "overwrite" },
      path: "beta.md",
    });

    const hits = knowledgeSearchResponseSchema.parse(
      await client.knowledge.search({ q: "quokka" }),
    );
    expect(hits.results.map((r) => r.path).toSorted()).toEqual(["alpha.md", "beta.md"]);

    const taggedHits = knowledgeSearchResponseSchema.parse(
      await client.knowledge.search({ q: "quokka tag:project" }),
    );
    expect(taggedHits.results.map((r) => r.path)).toEqual(["alpha.md"]);

    const parsed = knowledgeBacklinksResponseSchema.parse(
      await client.knowledge.backlinks({ path: "beta.md" }),
    );
    expect(parsed.backlinks.map((entry) => entry.sourcePath)).toEqual(["alpha.md"]);

    expect(knowledgeTagsResponseSchema.parse(await client.knowledge.tags())).toEqual({
      tags: [{ count: 1, tag: "project" }],
      total: 1,
    });
  });

  it("lists a tag's family by path, paged, with the whole count", async () => {
    const { client } = await bootTestApp();
    await client.vault.write({
      content: "# B\n\n#Work here.\n",
      guard: { kind: "overwrite" },
      path: "b.md",
    });
    await client.vault.write({
      content: "# A\n\n#work/deep here.\n",
      guard: { kind: "overwrite" },
      path: "a.md",
    });
    await client.vault.write({
      content: "# C\n\n#workshop is not it.\n",
      guard: { kind: "overwrite" },
      path: "c.md",
    });

    const whole = await client.knowledge.itemPaths({ sort: "title", tag: "work" });
    expect(whole).toEqual({ paths: ["a.md", "b.md"], total: 2 });

    const page = await client.knowledge.itemPaths({
      limit: 1,
      offset: 1,
      sort: "title",
      tag: "work",
    });
    expect(page).toEqual({ paths: ["b.md"], total: 2 });
  });

  it("ranks related notes with the reasons they are related", async () => {
    const { client } = await bootTestApp();
    // hub is a direct neighbour (backlinks' job), so it is absent from related.
    await client.vault.write({ content: "# Hub\n", guard: { kind: "overwrite" }, path: "hub.md" });
    await client.vault.write({
      content: "# Left\n\nSee [[hub]]. #shared\n",
      guard: { kind: "overwrite" },
      path: "left.md",
    });
    await client.vault.write({
      content: "# Right\n\nSee [[hub]]. #shared\n",
      guard: { kind: "overwrite" },
      path: "right.md",
    });

    const { path, related } = knowledgeRelatedResponseSchema.parse(
      await client.knowledge.related({ path: "left.md" }),
    );
    expect(path).toBe("left.md");
    expect(related.map((entry) => entry.path)).toEqual(["right.md"]);
    expect(related[0]?.reasons).toEqual(["both link to Hub", "shares #shared"]);

    const limited = knowledgeRelatedResponseSchema.parse(
      await client.knowledge.related({ limit: 1, path: "left.md" }),
    );
    expect(limited.related).toHaveLength(1);

    const [tooMany] = await safe(
      client.knowledge.related({ limit: KNOWLEDGE_RELATED_MAX_LIMIT + 1, path: "left.md" }),
    );
    expect(tooMany instanceof ORPCError && tooMany.code).toBe("BAD_REQUEST");
  });

  it("refuses a hostile path", async () => {
    const { client } = await bootTestApp();

    const [hostile] = await safe(client.knowledge.backlinks({ path: "../escape.md" }));
    expect(hostile instanceof ORPCError && hostile.code).toBe("BAD_REQUEST");
  });

  it("lists the library by its defaults, and narrows by folder, the root included", async () => {
    const { client } = await bootTestApp();
    await client.vault.write({
      content: "---\nid: a\nkind: link\nurl: https://a.com/\nsaved: 2026-10-02T00:00:00Z\n---\n",
      guard: { kind: "overwrite" },
      path: "Unsorted/a.md",
    });
    await client.vault.write({
      content: "---\nsaved: 2026-10-03T00:00:00Z\n---\nA root note about quokkas.\n",
      guard: { kind: "overwrite" },
      path: "root.md",
    });

    const all = knowledgeItemsResponseSchema.parse(await client.knowledge.items({}));
    expect(all.items.map((row) => row.path)).toEqual(["root.md", "Unsorted/a.md"]);
    expect(all.total).toBe(2);
    expect(all.kindCounts).toMatchObject({ link: 1, note: 1 });
    expect(all.items[1]).toMatchObject({ pending: true, saved: "2026-10-02T00:00:00Z" });

    const root = knowledgeItemsResponseSchema.parse(
      await client.knowledge.items({ folder: "", subfolders: false }),
    );
    expect(root.items.map((row) => row.path)).toEqual(["root.md"]);

    const searched = knowledgeItemPathsResponseSchema.parse(
      await client.knowledge.itemPaths({ q: "quokkas" }),
    );
    expect(searched).toEqual({ paths: ["root.md"], total: 1 });

    const since = knowledgeItemPathsResponseSchema.parse(
      await client.knowledge.itemPaths({ since: "2026-10-03" }),
    );
    expect(since.paths).toEqual(["root.md"]);

    expect(knowledgeScopesResponseSchema.parse(await client.knowledge.scopes())).toEqual({
      folders: [],
      total: 2,
      unsorted: 1,
      untagged: 2,
    });
  });

  it("refuses a tag asked with untagged, empty kinds and a since that is no date", async () => {
    const { client } = await bootTestApp();
    const refusals = [
      await safe(client.knowledge.items({ tag: "work", untagged: true })),
      await safe(client.knowledge.items({ kinds: [] })),
      await safe(client.knowledge.itemPaths({ since: "yesterday" })),
    ];
    for (const [refused] of refusals) {
      expect(refused instanceof ORPCError && refused.code).toBe("BAD_REQUEST");
    }
  });

  it("follows an item's id across a rename", async () => {
    const { client } = await bootTestApp();
    await client.vault.write({
      content: "---\nid: 7d2f9e40-1c6b-4a8e-9f31-5b0a6c2e8d17\n---\n# Moved\n",
      guard: { kind: "overwrite" },
      path: "before.md",
    });
    await client.vault.rename({ from: "before.md", to: "after.md" });
    expect(
      knowledgePathForNoteIdResponseSchema.parse(
        await client.knowledge.pathForNoteId({
          id: "7d2f9e40-1c6b-4a8e-9f31-5b0a6c2e8d17",
          lastPath: "before.md",
        }),
      ),
    ).toEqual({ path: "after.md", pending: false });
    expect(await client.knowledge.pathForNoteId({ id: "nobody", lastPath: "before.md" })).toEqual({
      path: null,
      pending: false,
    });
  });

  it("says a null is pending while the moved item's read is still out, and answers once it lands", async () => {
    // the new path's reads are held until the pending answer has been seen, so no runner is too
    // slow to see it; the rename's own alias write reads it too, so the rename answers after
    const held = Promise.withResolvers<null>();
    const { client } = await bootTestApp({
      readDeadlineMs: 20,
      stallRead: async (relPath) => {
        if (relPath === "after.md") {
          await held.promise;
        }
      },
    });
    await client.vault.write({
      content: "---\nid: 7d2f9e40-1c6b-4a8e-9f31-5b0a6c2e8d17\n---\n# Moved\n",
      guard: { kind: "overwrite" },
      path: "before.md",
    });
    const ask = { id: "7d2f9e40-1c6b-4a8e-9f31-5b0a6c2e8d17", lastPath: "before.md" };
    const renamed = client.vault.rename({ from: "before.md", to: "after.md" });
    await vi.waitFor(
      async () => {
        expect(await client.knowledge.pathForNoteId(ask)).toEqual({ path: null, pending: true });
      },
      { timeout: 5000 },
    );
    held.resolve(null);
    await renamed;
    await vi.waitFor(
      async () => {
        expect(await client.knowledge.pathForNoteId(ask)).toEqual({
          path: "after.md",
          pending: false,
        });
      },
      { timeout: 5000 },
    );
  });
});
