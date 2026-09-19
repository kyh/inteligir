import { readFile } from "node:fs/promises";
import path from "node:path";
import { bootTestApp } from "inteligir/server/testing";
import { describe, expect, it } from "vitest";
import { replaceInVault, summarizeReplace } from "../vault-replace";
import type { ReplaceVaultApi } from "../vault-replace";

const LOOSE = { caseSensitive: false, wholeWord: false };

describe("replacing across the vault", () => {
  it("rewrites only files whose hash matched at read, and names the one that moved", async () => {
    const { client, vaultDir } = await bootTestApp();
    await client.vault.write({ content: "Deploy on Friday\nnever deploy\n", path: "a.md" });
    await client.vault.write({ content: "deploy later\n", path: "b.md" });
    await client.vault.write({ content: "nothing\n", path: "c.md" });

    // b.md moves under the read: an agent's write landing between the listing and the rewrite
    const api: ReplaceVaultApi = {
      vault: {
        read: async (input) => {
          const answer = await client.vault.read(input);
          if (input.path === "b.md") {
            await client.vault.write({ content: "deploy moved\n", path: "b.md" });
          }
          return answer;
        },
        write: client.vault.write,
      },
    };

    const outcomes = await replaceInVault(api, {
      needle: "deploy",
      options: LOOSE,
      paths: ["a.md", "b.md", "c.md"],
      replacement: "ship",
    });
    expect(outcomes).toEqual([
      { count: 2, kind: "replaced", path: "a.md" },
      { kind: "changed", path: "b.md" },
      { kind: "unchanged", path: "c.md" },
    ]);
    expect(await readFile(path.join(vaultDir, "a.md"), "utf-8")).toBe(
      "ship on Friday\nnever ship\n",
    );
    expect(await readFile(path.join(vaultDir, "b.md"), "utf-8")).toBe("deploy moved\n");
    expect(summarizeReplace(outcomes)).toEqual({
      message: "Replaced 2 matches in 1 note. skipped, changed since read: b.md.",
      tone: "warning",
    });
  });

  it("reports a count after every note, and a cancel stops between notes, never inside one", async () => {
    const { client, vaultDir } = await bootTestApp();
    for (const name of ["a", "b", "c"]) {
      await client.vault.write({ content: "deploy\n", path: `${name}.md` });
    }
    const progress: [number, number][] = [];
    const controller = new AbortController();
    const outcomes = await replaceInVault(
      { vault: client.vault },
      { needle: "deploy", options: LOOSE, paths: ["a.md", "b.md", "c.md"], replacement: "ship" },
      {
        onProgress: (done, total) => {
          progress.push([done, total]);
          // the cancel lands after the first note's write; the second is never read
          if (done === 1) {
            controller.abort();
          }
        },
        signal: controller.signal,
      },
    );
    expect(progress).toEqual([[1, 3]]);
    expect(outcomes).toEqual([{ count: 1, kind: "replaced", path: "a.md" }]);
    expect(await readFile(path.join(vaultDir, "a.md"), "utf-8")).toBe("ship\n");
    expect(await readFile(path.join(vaultDir, "b.md"), "utf-8")).toBe("deploy\n");
    expect(await readFile(path.join(vaultDir, "c.md"), "utf-8")).toBe("deploy\n");
    expect(summarizeReplace(outcomes, 3 - outcomes.length)).toEqual({
      message: "Stopped after 1 note, 2 notes left untouched. Replaced 1 match in 1 note.",
      tone: "success",
    });
  });

  it("counts every note of a run that finishes", async () => {
    const { client } = await bootTestApp();
    await client.vault.write({ content: "deploy\n", path: "a.md" });
    await client.vault.write({ content: "nothing\n", path: "b.md" });
    const progress: [number, number][] = [];
    await replaceInVault(
      { vault: client.vault },
      { needle: "deploy", options: LOOSE, paths: ["a.md", "b.md"], replacement: "ship" },
      {
        onProgress: (done, total) => {
          progress.push([done, total]);
        },
      },
    );
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("says when nothing was replaced, and names a refusal", () => {
    expect(summarizeReplace([{ kind: "unchanged", path: "c.md" }])).toEqual({
      message: "Nothing replaced.",
      tone: "success",
    });
    expect(
      summarizeReplace([
        { count: 1, kind: "replaced", path: "a.md" },
        { kind: "failed", message: "read-only", path: "z.md" },
      ]),
    ).toEqual({
      message: "Replaced 1 match in 1 note. refused: z.md (read-only).",
      tone: "error",
    });
  });
});
