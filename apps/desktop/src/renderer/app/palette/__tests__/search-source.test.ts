import type { KnowledgeSearchResponse } from "@repo/api/local/knowledge/knowledge-schema";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { describe, expect, it } from "vitest";

import { createSearchSource, sortedNotePaths, type NoteSearchApi } from "../search-source";

const NEVER_ABORTED = new AbortController().signal;

function indexAnswering(answer: () => Promise<KnowledgeSearchResponse>) {
  const asked: string[] = [];
  const api = {
    knowledge: {
      search: (request) => {
        asked.push(request.q);
        return answer();
      },
    },
  } satisfies NoteSearchApi;
  return { asked, api };
}

const hit = (path: string): KnowledgeSearchResponse["results"][number] => ({
  path,
  title: path,
  snippet: "",
  score: 1,
});

const PATHS = ["notes/plans.md", "notes/tagging.md"];

describe("the palette's note paths", () => {
  it("names the notes and nothing else the tree carries", () => {
    const entries: readonly VaultEntry[] = [
      { kind: "file", path: "notes/plans.comments.json" },
      { kind: "file", path: "notes/plans.md" },
      { kind: "dir", path: "notes" },
      { kind: "file", path: "assets/diagram.png" },
      { kind: "file", path: "archive/old.md" },
    ];
    expect(sortedNotePaths(entries)).toEqual(["archive/old.md", "notes/plans.md"]);
  });
});

describe("the palette's search source", () => {
  it("answers an empty box from the filenames, asking the index nothing", async () => {
    const { api, asked } = indexAnswering(() => Promise.resolve({ results: [] }));
    const search = createSearchSource(api, PATHS);
    await expect(search("  ", NEVER_ABORTED)).resolves.toEqual([
      { path: "notes/plans.md" },
      { path: "notes/tagging.md" },
    ]);
    expect(asked).toEqual([]);
  });

  it("carries the index's own titles and snippets", async () => {
    const { api } = indexAnswering(() => Promise.resolve({ results: [hit("notes/plans.md")] }));
    const search = createSearchSource(api, PATHS);
    await expect(search("plans", NEVER_ABORTED)).resolves.toEqual([
      { path: "notes/plans.md", title: "notes/plans.md", snippet: "" },
    ]);
  });

  it("falls back to the filenames when the index misses or refuses", async () => {
    const missed = createSearchSource(
      indexAnswering(() => Promise.resolve({ results: [] })).api,
      PATHS,
    );
    await expect(missed("plans", NEVER_ABORTED)).resolves.toEqual([{ path: "notes/plans.md" }]);
    const refused = createSearchSource(
      indexAnswering(() => Promise.reject(new Error("offline"))).api,
      PATHS,
    );
    await expect(refused("plans", NEVER_ABORTED)).resolves.toEqual([{ path: "notes/plans.md" }]);
  });

  it("lets a tag query answer nothing rather than fuzzy-matching its own text", async () => {
    // "tag:plans" reaches `notes/tagging.md` as a subsequence, so a fallback
    // here would answer a question nobody asked with a straight face.
    const { api } = indexAnswering(() => Promise.resolve({ results: [] }));
    const search = createSearchSource(api, PATHS);
    await expect(search("tag:plans", NEVER_ABORTED)).resolves.toEqual([]);
  });
});
