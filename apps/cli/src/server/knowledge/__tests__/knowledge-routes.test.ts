// The knowledge API surface over the composed app: contract row → handler →
// runtime → index, fed by the vault runtime's change announcements.

import { ORPCError, safe } from "@orpc/client";
import {
  KNOWLEDGE_RELATED_MAX_LIMIT,
  knowledgeBacklinksResponseSchema,
  knowledgeRelatedResponseSchema,
  knowledgeSearchResponseSchema,
  knowledgeTagsResponseSchema,
  renameCandidatesResponseSchema,
} from "@repo/api/local/knowledge/knowledge-schema";
import { describe, expect, it } from "vitest";
import { bootTestApp } from "../../__tests__/boot-app";

describe("the knowledge routes", () => {
  it("searches, composes tag: terms, and answers backlinks and tags", async () => {
    const { client } = await bootTestApp();
    await client.vault.write({
      path: "alpha.md",
      content: "# Alpha\n\nMentions [[beta]] and #project quokka work.\n",
    });
    await client.vault.write({ path: "beta.md", content: "# Beta\n\nQuokka research.\n" });

    const hits = knowledgeSearchResponseSchema.parse(
      await client.knowledge.search({ q: "quokka" }),
    );
    expect(hits.results.map((r) => r.path).toSorted()).toEqual(["alpha.md", "beta.md"]);

    // The tag: grammar is parsed engine-side out of the one q parameter.
    const taggedHits = knowledgeSearchResponseSchema.parse(
      await client.knowledge.search({ q: "quokka tag:project" }),
    );
    expect(taggedHits.results.map((r) => r.path)).toEqual(["alpha.md"]);

    const parsed = knowledgeBacklinksResponseSchema.parse(
      await client.knowledge.backlinks({ path: "beta.md" }),
    );
    expect(parsed.backlinks.map((entry) => entry.sourcePath)).toEqual(["alpha.md"]);

    expect(knowledgeTagsResponseSchema.parse(await client.knowledge.tags())).toEqual({
      tags: [{ tag: "project", count: 1 }],
      total: 1,
    });
  });

  it("ranks related notes with the reasons they are related", async () => {
    const { client } = await bootTestApp();
    // `hub.md` is the shared target, so `left` and `right` are related to each
    // other by bibliographic coupling — and to `hub` by nothing, because a
    // direct neighbour is the Backlinks panel's job, not this one.
    await client.vault.write({ path: "hub.md", content: "# Hub\n" });
    await client.vault.write({ path: "left.md", content: "# Left\n\nSee [[hub]]. #shared\n" });
    await client.vault.write({ path: "right.md", content: "# Right\n\nSee [[hub]]. #shared\n" });

    const { path, related } = knowledgeRelatedResponseSchema.parse(
      await client.knowledge.related({ path: "left.md" }),
    );
    expect(path).toBe("left.md");
    expect(related.map((entry) => entry.path)).toEqual(["right.md"]);
    expect(related[0]?.reasons).toEqual(["both link to Hub", "shares #shared"]);

    const limited = knowledgeRelatedResponseSchema.parse(
      await client.knowledge.related({ path: "left.md", limit: 1 }),
    );
    expect(limited.related).toHaveLength(1);

    // Over the contract's ceiling is the validator's answer, not the handler's.
    const [tooMany] = await safe(
      client.knowledge.related({ path: "left.md", limit: KNOWLEDGE_RELATED_MAX_LIMIT + 1 }),
    );
    expect(tooMany instanceof ORPCError && tooMany.code).toBe("BAD_REQUEST");
  });

  it("names rename candidates and refuses a hostile path", async () => {
    const { client } = await bootTestApp();
    await client.vault.write({ path: "target.md", content: "# Target\n" });
    await client.vault.write({ path: "linker.md", content: "See [[target]].\n" });

    const { candidates, total } = renameCandidatesResponseSchema.parse(
      await client.knowledge.renameCandidates({ from: "target.md", to: "moved.md" }),
    );
    expect(candidates.toSorted()).toEqual(["linker.md", "target.md"]);
    expect(total).toBe(2);

    // The request validator answers, not the handler: the path grammar is on
    // the schema, so an index query can never be RUN against a hostile path.
    const [hostile] = await safe(
      client.knowledge.renameCandidates({ from: "../escape.md", to: "x.md" }),
    );
    expect(hostile instanceof ORPCError && hostile.code).toBe("BAD_REQUEST");

    const [hostileBacklinks] = await safe(client.knowledge.backlinks({ path: "../escape.md" }));
    expect(hostileBacklinks instanceof ORPCError && hostileBacklinks.code).toBe("BAD_REQUEST");
  });
});
