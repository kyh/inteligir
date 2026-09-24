// a vault and the knowledge runtime over it, wired as the composition root wires them: every
// mutation the service makes is announced to the index, so a suite reads its own writes back.

import { mkdirSync } from "node:fs";
import nodePath from "node:path";
import { noopNotifier } from "@repo/domain/notifier";
import { onTestFinished } from "vitest";
import { identityLock } from "../../__tests__/identity-lock";
import { ignoreFromDisk } from "../../__tests__/ignore-from-disk";
import { makeTempDir } from "../../__tests__/temp-dir";
import { createVaultService } from "../../vault/vault-service";
import type { VaultService } from "../../vault/vault-service";
import { createKnowledgeRuntime } from "../knowledge-runtime";
import type { KnowledgeRuntime, KnowledgeRuntimeArgs } from "../knowledge-runtime";
import type { Projector } from "../projector";
import { createInlineProjector } from "./inline-projector";

interface VaultDirs {
  dataDir: string;
  root: string;
}

// apart from the boot, so a suite can seed the vault first or boot twice over one index
export const makeVaultDirs = (prefix: string): VaultDirs => {
  const instanceDir = makeTempDir(prefix);
  const dirs = {
    dataDir: nodePath.join(instanceDir, "data"),
    root: nodePath.join(instanceDir, "vault"),
  };
  mkdirSync(dirs.root, { recursive: true });
  mkdirSync(dirs.dataDir, { recursive: true });
  return dirs;
};

interface IndexedVaultOptions {
  reader?: (service: VaultService) => KnowledgeRuntimeArgs["vault"];
  projector?: Projector;
  readDeadlineMs?: number;
}

interface IndexedVault {
  knowledge: KnowledgeRuntime;
  root: string;
  service: VaultService;
}

export const bootIndexedVault = (
  dirs: VaultDirs,
  {
    reader = (service) => service,
    projector = createInlineProjector(),
    readDeadlineMs,
  }: IndexedVaultOptions = {},
): IndexedVault => {
  // the service announces to a runtime built after it, over that same service
  let sink: KnowledgeRuntime | null = null;
  const service = createVaultService({
    ignore: ignoreFromDisk(dirs.root),
    lock: identityLock,
    notifier: noopNotifier,
    onMutated: (mutations) =>
      sink?.noteVaultChange({ kind: "paths", paths: mutations.map((mutation) => mutation.path) }),
    root: dirs.root,
  });
  const runtimeArgs: KnowledgeRuntimeArgs = {
    dataDir: dirs.dataDir,
    projector,
    vault: reader(service),
    vaultRoot: dirs.root,
  };
  if (readDeadlineMs !== undefined) {
    runtimeArgs.readDeadlineMs = readDeadlineMs;
  }
  const knowledge = createKnowledgeRuntime(runtimeArgs);
  sink = knowledge;
  onTestFinished(async () => {
    await knowledge.dispose();
  });
  return { knowledge, root: dirs.root, service };
};
