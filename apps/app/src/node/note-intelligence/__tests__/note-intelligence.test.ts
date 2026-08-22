// Note Intelligence over a REAL vault service with a FAKE inference runner —
// the claude child is a seam, and every property here is about the WRITES:
// absent fields only, user-set values untouched, refusal-on-concurrent-edit
// skips, toggle-off spawns nothing, malformed inference skips.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { noopNotifier } from "@repo/domain/notifier";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { createVaultService } from "../../vault/vault-service";
import { parseInferenceOutput } from "../infer";
import type { InferenceRunner, InferredFields } from "../infer";
import { createNoteIntelligence } from "../note-intelligence";
import { createNoteIntelligenceSettingsStore } from "../settings-store";

const INFERRED: InferredFields = {
  description: "A test note about inference.",
  status: "draft",
  tags: ["testing", "inference"],
};

function boot(infer: InferenceRunner) {
  const dir = makeTempDir("inteligir-noteintel-");
  const root = join(dir, "vault");
  mkdirSync(root, { recursive: true });
  const vault = createVaultService({ root, notifier: noopNotifier });
  const settings = createNoteIntelligenceSettingsStore(join(dir, "data"));
  const service = createNoteIntelligence({ infer, settings, vault });
  return { root, service, settings, vault };
}

describe("note intelligence", () => {
  it("adds only the fields a note lacks, and never rewrites a user-set one", async () => {
    const calls: string[] = [];
    const { root, service } = boot((body) => {
      calls.push(body);
      return Promise.resolve(INFERRED);
    });
    writeFileSync(join(root, "bare.md"), "# Bare\n\nSome body.\n");
    writeFileSync(join(root, "half.md"), "---\ndescription: my own words\n---\n# Half\n\nBody.\n");

    const sweep = await service.sweepNow();

    expect(sweep.scanned).toBe(2);
    expect(sweep.updated).toBe(2);
    const bare = readFileSync(join(root, "bare.md"), "utf8");
    expect(bare).toContain("description: A test note about inference.");
    expect(bare).toContain("status: draft");
    expect(bare).toContain("- testing");
    expect(bare.endsWith("# Bare\n\nSome body.\n")).toBe(true);
    const half = readFileSync(join(root, "half.md"), "utf8");
    // The user's description survives byte-exactly; only the absent pair land.
    expect(half).toContain("description: my own words");
    expect(half).not.toContain("A test note about inference");
    expect(half).toContain("status: draft");
    expect(calls.length).toBe(2);
  });

  it("converges: a completed note costs a read and no inference on the next sweep", async () => {
    let calls = 0;
    const { root, service } = boot(() => {
      calls += 1;
      return Promise.resolve(INFERRED);
    });
    writeFileSync(join(root, "note.md"), "# N\n\nBody.\n");

    await service.sweepNow();
    const afterFirst = calls;
    const second = await service.sweepNow();

    expect(afterFirst).toBe(1);
    expect(calls).toBe(1);
    expect(second.updated).toBe(0);
  });

  it("skips on a concurrent edit instead of clobbering it", async () => {
    const { root, service, vault } = boot(async () => {
      // The edit lands between the sweep's read and its guarded write.
      await vault.write("note.md", "# N\n\nEdited meanwhile.\n");
      return INFERRED;
    });
    writeFileSync(join(root, "note.md"), "# N\n\nBody.\n");

    const sweep = await service.sweepNow();

    expect(sweep.updated).toBe(0);
    expect(sweep.skipped).toBe(1);
    expect(readFileSync(join(root, "note.md"), "utf8")).toBe("# N\n\nEdited meanwhile.\n");
  });

  it("spawns nothing while the toggle is off", async () => {
    let calls = 0;
    const { root, service } = boot(() => {
      calls += 1;
      return Promise.resolve(INFERRED);
    });
    writeFileSync(join(root, "note.md"), "# N\n\nBody.\n");

    expect(service.status().enabled).toBe(false);
    service.noteVaultChange();
    await new Promise((resolve) => setTimeout(resolve, 20));
    service.dispose();

    expect(calls).toBe(0);
  });

  it("a failed or malformed inference skips the note and leaves it untouched", async () => {
    const { root, service } = boot(() => Promise.resolve(null));
    writeFileSync(join(root, "note.md"), "# N\n\nBody.\n");

    const sweep = await service.sweepNow();

    expect(sweep.updated).toBe(0);
    expect(sweep.skipped).toBe(1);
    expect(readFileSync(join(root, "note.md"), "utf8")).toBe("# N\n\nBody.\n");
  });

  it("persists the toggle and reports it in status", () => {
    const { service, settings } = boot(() => Promise.resolve(null));
    expect(service.status().enabled).toBe(false);
    service.setEnabled(true);
    expect(settings.readEnabled()).toBe(true);
    service.setEnabled(false);
    expect(settings.readEnabled()).toBe(false);
    service.dispose();
  });
});

describe("inference output parsing", () => {
  it("accepts fenced or prefaced JSON and refuses the malformed", () => {
    const good = parseInferenceOutput(
      'Here you go:\n```json\n{"description":"x","tags":["a-b"],"status":"draft"}\n```',
    );
    expect(good?.status).toBe("draft");
    expect(parseInferenceOutput("no json at all")).toBeNull();
    expect(
      parseInferenceOutput('{"description":"x","tags":["Bad Tag"],"status":"draft"}'),
    ).toBeNull();
    expect(parseInferenceOutput('{"description":"x","tags":[],"status":"someday"}')).toBeNull();
  });
});
