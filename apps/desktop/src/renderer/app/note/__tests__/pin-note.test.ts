import { contentHashHex } from "@repo/api/local/vault/vault-schema";
import { describe, expect, it } from "vitest";

import { setNotePinned } from "../pin-note";
import type { PinNoteApi } from "../pin-note";

interface Written {
  path: string;
  content: string;
  expectedHash?: string;
}

const fakeApi = (disk: string, writes: Written[], refuse: string | null = null): PinNoteApi => ({
  vault: {
    read: async () => ({ content: disk, path: "notes/a.md" }),
    write: async (input) => {
      if (refuse !== null) {
        throw new Error(refuse);
      }
      const written: Written = { content: input.content, path: input.path };
      if (input.expectedHash !== undefined) {
        written.expectedHash = input.expectedHash;
      }
      writes.push(written);
      return { path: input.path };
    },
  },
});

describe("pinning a note that is not open", () => {
  it("writes the pinned bytes against the hash of what it read", async () => {
    const writes: Written[] = [];
    const disk = "---\ntitle: A\n---\nbody\n";
    const outcome = await setNotePinned(fakeApi(disk, writes), "notes/a.md", true);
    expect(outcome).toEqual({ kind: "done" });
    expect(writes).toEqual([
      {
        content: "---\ntitle: A\npinned: true\n---\nbody\n",
        expectedHash: await contentHashHex(disk),
        path: "notes/a.md",
      },
    ]);
  });

  it("writes nothing when the note already says so", async () => {
    const writes: Written[] = [];
    const outcome = await setNotePinned(
      fakeApi("---\npinned: true\n---\nbody\n", writes),
      "notes/a.md",
      true,
    );
    expect(outcome).toEqual({ kind: "unchanged" });
    expect(writes).toEqual([]);
  });

  it("refuses frontmatter it cannot read, and writes nothing", async () => {
    const writes: Written[] = [];
    const outcome = await setNotePinned(
      fakeApi("---\na: [unclosed\n---\nbody\n", writes),
      "notes/a.md",
      true,
    );
    expect(outcome.kind).toBe("refused");
    expect(writes).toEqual([]);
  });

  it("reports a write the server refused, by name", async () => {
    const outcome = await setNotePinned(
      fakeApi("body\n", [], "the file changed since it was read"),
      "notes/a.md",
      true,
    );
    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") {
      expect(outcome.message).toContain("notes/a.md");
    }
  });
});
