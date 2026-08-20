// The memory routes end to end through the composed app: list reads the
// directory the config names, remove deletes one file and answers the fresh
// listing, and the two refusals (bad name, missing file) carry the contract's
// own classes. Human-facing routes — there is no agent write path to test.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { bootTestApp } from "../../__tests__/boot-app";

/** boot-app puts the memory dir beside the data dir under one instance dir. */
function memoryDirOf(dataDir: string): string {
  const dir = join(dirname(dataDir), "memory");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFact(dir: string, file: string, frontmatter: string): void {
  writeFileSync(join(dir, file), `---\n${frontmatter}\n---\nbody of ${file}\n`, "utf8");
}

describe("memory routes", () => {
  it("lists valid facts and surfaces malformed files", async () => {
    const boot = await bootTestApp();
    const dir = memoryDirOf(boot.dataDir);
    writeFact(dir, "role.md", "name: Role\ndescription: writes notes\ntype: user");
    writeFileSync(join(dir, "broken.md"), "no frontmatter here\n", "utf8");

    const response = await boot.client.memory.$get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.memories).toEqual([
      {
        file: "role.md",
        name: "Role",
        description: "writes notes",
        type: "user",
        body: "body of role.md\n",
      },
    ]);
    expect(body.malformed.map((entry) => entry.file)).toEqual(["broken.md"]);
  });

  it("removes a file and answers the fresh listing", async () => {
    const boot = await bootTestApp();
    const dir = memoryDirOf(boot.dataDir);
    writeFact(dir, "keep.md", "name: Keep\ndescription: stays\ntype: preference");
    writeFact(dir, "drop.md", "name: Drop\ndescription: goes\ntype: preference");

    const response = await boot.client.memory.remove.$post({ json: { file: "drop.md" } });
    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }
    const body = await response.json();
    expect(body.memories.map((entry) => entry.file)).toEqual(["keep.md"]);
  });

  it("refuses a missing file with 404 and a traversal with 400", async () => {
    const boot = await bootTestApp();
    memoryDirOf(boot.dataDir);

    const missing = await boot.client.memory.remove.$post({ json: { file: "nope.md" } });
    expect(missing.status).toBe(404);

    const traversal = await boot.client.memory.remove.$post({ json: { file: "../escape.md" } });
    expect(traversal.status).toBe(400);
  });
});
