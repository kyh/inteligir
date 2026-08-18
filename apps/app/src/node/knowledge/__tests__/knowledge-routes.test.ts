// The knowledge API surface over the composed app: contract row → handler →
// runtime → index, fed by the vault runtime's change announcements.

import {
  KNOWLEDGE_RELATED_MAX_LIMIT,
  knowledgeBacklinksResponseSchema,
  knowledgeRelatedResponseSchema,
  knowledgeSearchResponseSchema,
  knowledgeTagsResponseSchema,
  renameCandidatesResponseSchema,
} from "@repo/server-contract/knowledge";
import { apiErrorResponseSchema } from "@repo/server-contract/errors";
import { describe, expect, it } from "vitest";
import { bootTestApp } from "../../__tests__/boot-app";

async function bootApp() {
  const { composed } = await bootTestApp();
  return { app: composed.app };
}

function putNote(path: string, content: string): RequestInit {
  return {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, content }),
  };
}

describe("the knowledge routes", () => {
  it("searches, composes tag: terms, and answers backlinks and tags", async () => {
    const { app } = await bootApp();
    await app.request(
      "/api/v1/vault/file",
      putNote("alpha.md", "# Alpha\n\nMentions [[beta]] and #project quokka work.\n"),
    );
    await app.request("/api/v1/vault/file", putNote("beta.md", "# Beta\n\nQuokka research.\n"));

    const search = await app.request("/api/v1/knowledge/search?q=quokka");
    expect(search.status).toBe(200);
    const hits = knowledgeSearchResponseSchema.parse(await search.json());
    expect(hits.results.map((r) => r.path).toSorted()).toEqual(["alpha.md", "beta.md"]);

    // The tag: grammar is parsed engine-side out of the one q parameter.
    const tagged = await app.request("/api/v1/knowledge/search?q=quokka%20tag%3Aproject");
    const taggedHits = knowledgeSearchResponseSchema.parse(await tagged.json());
    expect(taggedHits.results.map((r) => r.path)).toEqual(["alpha.md"]);

    const backlinks = await app.request("/api/v1/knowledge/backlinks?path=beta.md");
    expect(backlinks.status).toBe(200);
    const parsed = knowledgeBacklinksResponseSchema.parse(await backlinks.json());
    expect(parsed.backlinks.map((entry) => entry.sourcePath)).toEqual(["alpha.md"]);

    const tags = await app.request("/api/v1/knowledge/tags");
    expect(knowledgeTagsResponseSchema.parse(await tags.json())).toEqual({
      tags: [{ tag: "project", count: 1 }],
      total: 1,
    });
  });

  it("ranks related notes with the reasons they are related", async () => {
    const { app } = await bootApp();
    // `hub.md` is the shared target, so `left` and `right` are related to each
    // other by bibliographic coupling — and to `hub` by nothing, because a
    // direct neighbour is the Backlinks panel's job, not this one.
    await app.request("/api/v1/vault/file", putNote("hub.md", "# Hub\n"));
    await app.request("/api/v1/vault/file", putNote("left.md", "# Left\n\nSee [[hub]]. #shared\n"));
    await app.request(
      "/api/v1/vault/file",
      putNote("right.md", "# Right\n\nSee [[hub]]. #shared\n"),
    );

    const response = await app.request("/api/v1/knowledge/related?path=left.md");
    expect(response.status).toBe(200);
    const { path, related } = knowledgeRelatedResponseSchema.parse(await response.json());
    expect(path).toBe("left.md");
    expect(related.map((entry) => entry.path)).toEqual(["right.md"]);
    expect(related[0]?.reasons).toEqual(["both link to Hub", "shares #shared"]);

    const limited = await app.request("/api/v1/knowledge/related?path=left.md&limit=1");
    expect(knowledgeRelatedResponseSchema.parse(await limited.json()).related).toHaveLength(1);

    // Over the contract's ceiling is the validator's answer, not the handler's.
    const tooMany = await app.request(
      `/api/v1/knowledge/related?path=left.md&limit=${KNOWLEDGE_RELATED_MAX_LIMIT + 1}`,
    );
    expect(tooMany.status).toBe(400);
  });

  it("names rename candidates and refuses a hostile path", async () => {
    const { app } = await bootApp();
    await app.request("/api/v1/vault/file", putNote("target.md", "# Target\n"));
    await app.request("/api/v1/vault/file", putNote("linker.md", "See [[target]].\n"));

    const response = await app.request(
      "/api/v1/knowledge/rename-candidates?from=target.md&to=moved.md",
    );
    expect(response.status).toBe(200);
    const { candidates, total } = renameCandidatesResponseSchema.parse(await response.json());
    expect(candidates.toSorted()).toEqual(["linker.md", "target.md"]);
    expect(total).toBe(2);

    // The request validator answers, not the handler: the path grammar is on
    // the schema, so an index query can never be RUN against a hostile path.
    const hostile = await app.request(
      "/api/v1/knowledge/rename-candidates?from=..%2Fescape.md&to=x.md",
    );
    expect(hostile.status).toBe(400);
    expect(apiErrorResponseSchema.parse(await hostile.json()).error).toBe("invalid_request");

    const hostileBacklinks = await app.request("/api/v1/knowledge/backlinks?path=..%2Fescape.md");
    expect(hostileBacklinks.status).toBe(400);
    expect(apiErrorResponseSchema.parse(await hostileBacklinks.json()).error).toBe(
      "invalid_request",
    );
  });
});
