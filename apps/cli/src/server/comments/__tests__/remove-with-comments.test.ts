import { existsSync, mkdirSync } from "node:fs";
import nodePath from "node:path";
import { noopNotifier } from "@repo/domain/notifier";
import { commentsStorePath } from "@repo/notes/comments/sidecar-schema";
import { describe, expect, it, onTestFinished } from "vitest";
import { identityLock } from "../../__tests__/identity-lock";
import { makeTempDir } from "../../__tests__/temp-dir";
import { createKnowledgeRuntime } from "../../knowledge/knowledge-runtime";
import type { KnowledgeRuntime } from "../../knowledge/knowledge-runtime";
import { createVaultService } from "../../vault/vault-service";
import { removeEntryWithComments } from "../remove-with-comments";

const NOTE_ID = "0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b";
const STORE = commentsStorePath(NOTE_ID);
const NOTE = `---\nid: ${NOTE_ID}\n---\n%%i:c1:start%%x%%i:c1:end%%\n`;
const STORE_BYTES = '{\n  "c1": { "text": "kept", "createdAt": 1, "updatedAt": 1 }\n}\n';

const boot = () => {
  const instanceDir = makeTempDir("inteligir-remove-with-comments-");
  const root = nodePath.join(instanceDir, "vault");
  const dataDir = nodePath.join(instanceDir, "data");
  mkdirSync(root, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  let sink: KnowledgeRuntime | null = null;
  const service = createVaultService({
    lock: identityLock,
    notifier: noopNotifier,
    onMutated: (paths) => sink?.noteVaultChange({ kind: "paths", paths }),
    root,
  });
  const knowledge = createKnowledgeRuntime({ dataDir, vault: service, vaultRoot: root });
  sink = knowledge;
  onTestFinished(async () => {
    await knowledge.dispose();
  });
  const storeOnDisk = (): boolean => existsSync(nodePath.join(root, STORE));
  return { knowledge, service, storeOnDisk };
};

describe("a delete takes a note's comment store only when no other note carries its id", () => {
  it("keeps the store a byte copy shares, and removes it with the last note carrying the id", async () => {
    const { knowledge, service, storeOnDisk } = boot();
    await service.write("Plan.md", NOTE);
    await service.write("Plan copy.md", NOTE);
    await service.write(STORE, STORE_BYTES);

    expect(await removeEntryWithComments(service, "Plan copy.md", knowledge)).toEqual({
      keptStores: [STORE],
    });
    const kept = await service.read(STORE);
    expect(kept.content).toBe(STORE_BYTES);

    expect(await removeEntryWithComments(service, "Plan.md", knowledge)).toEqual({
      keptStores: [],
    });
    expect(storeOnDisk()).toBe(false);
  });

  it("removes the store with a folder holding every note that carries the id", async () => {
    const { knowledge, service, storeOnDisk } = boot();
    await service.write("box/Plan.md", NOTE);
    await service.write("box/deeper/Plan copy.md", NOTE);
    await service.write(STORE, STORE_BYTES);

    expect(await removeEntryWithComments(service, "box", knowledge)).toEqual({ keptStores: [] });
    expect(storeOnDisk()).toBe(false);
  });

  it("keeps the store when the note carrying the id lives outside the removed folder", async () => {
    const { knowledge, service, storeOnDisk } = boot();
    await service.write("box/Plan copy.md", NOTE);
    await service.write("Plan.md", NOTE);
    await service.write(STORE, STORE_BYTES);

    expect(await removeEntryWithComments(service, "box", knowledge)).toEqual({
      keptStores: [STORE],
    });
    expect(storeOnDisk()).toBe(true);
  });
});
