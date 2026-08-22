// Boot sanity over a generated 300-file vault: one cold reconcile projects
// everything, and the index answers correctly afterwards. A correctness
// check at realistic scale, not a benchmark.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { noopNotifier } from "@repo/domain/notifier";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { createVaultService } from "../../vault/vault-service";
import { createKnowledgeRuntime } from "../knowledge-runtime";
import { identityLock } from "../../__tests__/identity-lock";

const FILE_COUNT = 300;

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
});

describe("a 300-file vault", () => {
  it("boots, reconciles once, and answers search/backlinks/tags", async () => {
    const instanceDir = makeTempDir("inteligir-knowledge-fixture-");
    const root = join(instanceDir, "vault");
    const dataDir = join(instanceDir, "data");
    mkdirSync(join(root, "notes"), { recursive: true });
    mkdirSync(dataDir, { recursive: true });

    for (let i = 0; i < FILE_COUNT; i++) {
      const next = (i + 1) % FILE_COUNT;
      writeFileSync(
        join(root, "notes", `note-${i}.md`),
        `# Note ${i}\n\nTagged #bucket-${i % 10}. Links to [[note-${next}]].\n` +
          `Unique marker token-${i}-marker.\n`,
      );
    }

    const service = createVaultService({ lock: identityLock, notifier: noopNotifier, root });
    const knowledge = createKnowledgeRuntime({ dataDir, vault: service, vaultRoot: root });
    cleanups.push(() => knowledge.dispose());

    await knowledge.settle();
    expect(knowledge.lastReconcile).toEqual({
      projected: FILE_COUNT,
      removed: 0,
      unchanged: 0,
    });

    // note-149 also matches ("150" rides its [[note-150]] link); the doc that
    // holds the whole marker must outrank it.
    const hits = await knowledge.search({ query: "token-150-marker", limit: 5 });
    expect(hits[0]?.path).toBe("notes/note-150.md");

    const backlinks = await knowledge.backlinks("notes/note-150.md");
    expect(backlinks.map((entry) => entry.sourcePath)).toEqual(["notes/note-149.md"]);

    const tags = await knowledge.tags();
    expect(tags).toHaveLength(10);
    expect(tags.every((tag) => tag.count === FILE_COUNT / 10)).toBe(true);
  });
});
