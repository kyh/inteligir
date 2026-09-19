import { ORPCError, safe } from "@orpc/client";
import {
  KNOWLEDGE_RELATED_MAX_LIMIT,
  knowledgeBacklinksResponseSchema,
  knowledgeRelatedResponseSchema,
  knowledgeSearchResponseSchema,
  knowledgeTagNotesResponseSchema,
  knowledgeTagsResponseSchema,
} from "@repo/api/local/knowledge/knowledge-schema";
import { describe, expect, it } from "vitest";
import { bootTestApp } from "../../__tests__/boot-app";

describe("the knowledge routes", () => {
  it("searches, composes tag: terms, and answers backlinks and tags", async () => {
    const { client } = await bootTestApp();
    await client.vault.write({
      content: "# Alpha\n\nMentions [[beta]] and #project quokka work.\n",
      path: "alpha.md",
    });
    await client.vault.write({ content: "# Beta\n\nQuokka research.\n", path: "beta.md" });

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
    await client.vault.write({ content: "# B\n\n#Work here.\n", path: "b.md" });
    await client.vault.write({ content: "# A\n\n#work/deep here.\n", path: "a.md" });
    await client.vault.write({ content: "# C\n\n#workshop is not it.\n", path: "c.md" });

    const whole = knowledgeTagNotesResponseSchema.parse(
      await client.knowledge.tagNotes({ tag: "work" }),
    );
    expect(whole).toEqual({ paths: ["a.md", "b.md"], tag: "work", total: 2 });

    const page = knowledgeTagNotesResponseSchema.parse(
      await client.knowledge.tagNotes({ limit: 1, offset: 1, tag: "work" }),
    );
    expect(page).toEqual({ paths: ["b.md"], tag: "work", total: 2 });
  });

  it("ranks related notes with the reasons they are related", async () => {
    const { client } = await bootTestApp();
    // hub is a direct neighbour (backlinks' job), so it is absent from related.
    await client.vault.write({ content: "# Hub\n", path: "hub.md" });
    await client.vault.write({ content: "# Left\n\nSee [[hub]]. #shared\n", path: "left.md" });
    await client.vault.write({ content: "# Right\n\nSee [[hub]]. #shared\n", path: "right.md" });

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
});
