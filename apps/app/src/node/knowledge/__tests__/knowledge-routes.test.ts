// The knowledge API surface over the composed app: contract row → handler →
// runtime → index, fed by the vault runtime's change announcements.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "@repo/db/connection";
import { getSchemaVersion } from "@repo/db/meta";
import { runMigrations } from "@repo/db/migrate";
import {
  knowledgeBacklinksResponseSchema,
  knowledgeSearchResponseSchema,
  knowledgeTagsResponseSchema,
  renameCandidatesResponseSchema,
} from "@repo/server-contract/knowledge";
import { apiErrorResponseSchema } from "@repo/server-contract/routes";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { unavailableTurnDriver } from "../../threads/turn-driver";
import { hermeticGitEnv } from "../../vault/__tests__/git-test-env";
import { createVaultRuntime } from "../../vault/vault-runtime";
import { WsBus } from "../../ws-bus";
import { createKnowledgeRuntime, type KnowledgeRuntime } from "../knowledge-runtime";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
});

async function bootApp() {
  const instanceDir = mkdtempSync(join(tmpdir(), "inteligir-knowledge-routes-"));
  cleanups.push(() => rmSync(instanceDir, { recursive: true, force: true }));
  const dataDir = join(instanceDir, "data");
  const vaultDir = join(instanceDir, "vault");
  mkdirSync(dataDir, { recursive: true });
  const db = createConnection(join(dataDir, "inteligir.db"));
  runMigrations(db);
  const bus = new WsBus({ version: "0.1.0-test" });
  let sink: KnowledgeRuntime | null = null;
  const vault = await createVaultRuntime({
    vaultDir,
    vaultRemote: null,
    dataDir,
    notifier: bus,
    onFilesChanged: (change) => sink?.noteVaultChange(change),
    watch: false,
    syncIntervalMs: null,
    gitEnv: hermeticGitEnv(),
  });
  cleanups.push(() => vault.dispose());
  const knowledge = createKnowledgeRuntime({ dataDir, vault: vault.service, vaultRoot: vaultDir });
  sink = knowledge;
  cleanups.push(() => knowledge.dispose());
  const { app } = createApp({
    bus,
    createTurnDriver: () => unavailableTurnDriver,
    db,
    config: {
      databasePath: join(dataDir, "inteligir.db"),
      dataDir,
      dataDirSource: "env",
      mode: "dev",
      port: 0,
      portSource: "env",
      vaultDir,
      vaultRemote: null,
    },
    fallback: { kind: "none" },
    knowledge,
    schemaVersion: getSchemaVersion(db),
    startedAt: Date.now(),
    vault,
    version: "0.1.0-test",
  });
  return { app };
}

function putNote(path: string, content: string): RequestInit {
  return {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, content }),
  };
}

describe("the knowledge routes", () => {
  it("searches, composes tag: terms, and answers backlinks and tags", async () => {
    const { app } = await bootApp();
    await app.request(
      "/api/v1/vault/file",
      putNote("alpha.md", "# Alpha\n\nMentions [[beta]] and #project quokka work.\n"),
    );
    await app.request("/api/v1/vault/file", putNote("beta.md", "# Beta\n\nQuokka research.\n"));

    const search = await app.request("/api/v1/knowledge/search?q=quokka");
    expect(search.status).toBe(200);
    const hits = knowledgeSearchResponseSchema.parse(await search.json());
    expect(hits.results.map((r) => r.path).toSorted()).toEqual(["alpha.md", "beta.md"]);

    // The tag: grammar is parsed engine-side out of the one q parameter.
    const tagged = await app.request("/api/v1/knowledge/search?q=quokka%20tag%3Aproject");
    const taggedHits = knowledgeSearchResponseSchema.parse(await tagged.json());
    expect(taggedHits.results.map((r) => r.path)).toEqual(["alpha.md"]);

    const backlinks = await app.request("/api/v1/knowledge/backlinks?path=beta.md");
    expect(backlinks.status).toBe(200);
    const parsed = knowledgeBacklinksResponseSchema.parse(await backlinks.json());
    expect(parsed.backlinks.map((entry) => entry.sourcePath)).toEqual(["alpha.md"]);

    const tags = await app.request("/api/v1/knowledge/tags");
    expect(knowledgeTagsResponseSchema.parse(await tags.json())).toEqual({
      tags: [{ tag: "project", count: 1 }],
    });
  });

  it("names rename candidates and refuses a hostile path", async () => {
    const { app } = await bootApp();
    await app.request("/api/v1/vault/file", putNote("target.md", "# Target\n"));
    await app.request("/api/v1/vault/file", putNote("linker.md", "See [[target]].\n"));

    const response = await app.request(
      "/api/v1/knowledge/rename-candidates?from=target.md&to=moved.md",
    );
    expect(response.status).toBe(200);
    const { candidates } = renameCandidatesResponseSchema.parse(await response.json());
    expect(candidates.toSorted()).toEqual(["linker.md", "target.md"]);

    const hostile = await app.request(
      "/api/v1/knowledge/rename-candidates?from=..%2Fescape.md&to=x.md",
    );
    expect(hostile.status).toBe(400);
    expect(apiErrorResponseSchema.parse(await hostile.json()).error).toBe("invalid_path");
  });
});
