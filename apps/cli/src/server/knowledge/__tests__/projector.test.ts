// the real worker, booted from source under tsx: seconds per boot, so one projector serves the
// suite and only the dispose case pays for its own.

import { computeMoveEdits } from "@repo/notes/knowledge/rename-links";
import { computeTagRenameEdits } from "@repo/notes/knowledge/rename-tags";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RenameEditsJob } from "../projection-protocol";
import { createProjectionWorker } from "../projector";
import type { Projector } from "../projector";

const BOOT_TIMEOUT_MS = 60_000;

let projector: Projector;

beforeAll(() => {
  projector = createProjectionWorker();
});

afterAll(async () => {
  await projector.dispose();
});

describe("the projection worker", () => {
  it(
    "answers every doc in the order it was sent, projected and stemmed",
    async () => {
      const results = await projector.project([
        { content: "# Alpha\n\nQuokkas near [[Beta]] #field\n", path: "alpha.md" },
        { content: "---\naliases: [Second]\n---\n# Beta\n", path: "beta.md" },
      ]);

      expect(results.map((result) => result.kind)).toEqual(["projected", "projected"]);
      const [alpha, beta] = results;
      expect(alpha?.kind === "projected" && alpha.projection.links[0]?.target).toBe("Beta");
      expect(alpha?.kind === "projected" && alpha.search.bodyStems).toContain("quokka");
      expect(beta?.kind === "projected" && beta.search.headings).toBe("Beta\nSecond");
    },
    BOOT_TIMEOUT_MS,
  );

  it(
    "computes both rewrite sets as the pure functions do",
    async () => {
      const uuid = "9e64c3df-c1e2-4a4d-8c07-91528f422413";
      const docs = new Map([
        ["a.md", `See [[Old]], [[Gone|${uuid}]] and #project/alpha.\n`],
        ["b.md", "---\ntags: [project]\n---\nNothing linked.\n"],
      ]);
      const rename: RenameEditsJob = {
        aliasEntries: [],
        allFiles: ["a.md", "b.md", "Old.md"],
        docs,
        idEntries: [[uuid, "Old.md"]],
        moves: new Map([["Old.md", "New.md"]]),
      };
      const renamed = computeMoveEdits(rename);
      const retagged = computeTagRenameEdits(docs, "project", "work");
      expect(renamed.get("a.md")).toBe(`See [[New]], [[New|${uuid}]] and #project/alpha.\n`);
      expect([...retagged.keys()]).toEqual(["a.md", "b.md"]);

      expect(await projector.renameEdits(rename)).toEqual(renamed);
      expect(await projector.tagRenameEdits({ docs, from: "project", to: "work" })).toEqual(
        retagged,
      );
    },
    BOOT_TIMEOUT_MS,
  );

  it(
    "fails a job in flight the moment it is disposed, and refuses the next",
    async () => {
      const own = createProjectionWorker();
      await own.project([{ content: "# Warm\n", path: "warm.md" }]);

      const long = own.project([
        { content: "Entry about quokkas.\n".repeat(20_000), path: "big.md" },
      ]);
      const refused = expect(long).rejects.toThrow("disposed");
      await own.dispose();
      await refused;
      await expect(own.project([{ content: "# Late\n", path: "late.md" }])).rejects.toThrow(
        "disposed",
      );
    },
    BOOT_TIMEOUT_MS,
  );
});
