import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { bootTestApp } from "inteligir/server/testing";
import { describe, expect, it } from "vitest";
import { replaceInVault, summarizeReplace, type ReplaceVaultApi } from "../vault-replace";

const LOOSE = { caseSensitive: false, wholeWord: false };

describe("replacing across the vault", () => {
  it("rewrites only files whose hash matched at read, and names the one that moved", async () => {
    const { client, vaultDir } = await bootTestApp();
    await client.vault.write({ path: "a.md", content: "Deploy on Friday\nnever deploy\n" });
    await client.vault.write({ path: "b.md", content: "deploy later\n" });
    await client.vault.write({ path: "c.md", content: "nothing\n" });

    // b.md moves under the read: an agent's write landing between the listing and the rewrite
    const api: ReplaceVaultApi = {
      vault: {
        read: async (input) => {
          const answer = await client.vault.read(input);
          if (input.path === "b.md") {
            await client.vault.write({ path: "b.md", content: "deploy moved\n" });
          }
          return answer;
        },
        write: client.vault.write,
      },
    };

    const outcomes = await replaceInVault(api, {
      needle: "deploy",
      replacement: "ship",
      options: LOOSE,
      paths: ["a.md", "b.md", "c.md"],
    });
    expect(outcomes).toEqual([
      { path: "a.md", kind: "replaced", count: 2 },
      { path: "b.md", kind: "changed" },
      { path: "c.md", kind: "unchanged" },
    ]);
    expect(await readFile(join(vaultDir, "a.md"), "utf8")).toBe("ship on Friday\nnever ship\n");
    expect(await readFile(join(vaultDir, "b.md"), "utf8")).toBe("deploy moved\n");
    expect(summarizeReplace(outcomes)).toEqual({
      tone: "warning",
      message: "Replaced 2 matches in 1 note. skipped, changed since read: b.md.",
    });
  });

  it("says when nothing was replaced, and names a refusal", () => {
    expect(summarizeReplace([{ path: "c.md", kind: "unchanged" }])).toEqual({
      tone: "success",
      message: "Nothing replaced.",
    });
    expect(
      summarizeReplace([
        { path: "a.md", kind: "replaced", count: 1 },
        { path: "z.md", kind: "failed", message: "read-only" },
      ]),
    ).toEqual({
      tone: "error",
      message: "Replaced 1 match in 1 note. refused: z.md (read-only).",
    });
  });
});
